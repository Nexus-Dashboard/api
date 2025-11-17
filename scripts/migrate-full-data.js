// scripts/migrate-full-data.js
require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');
const { getModel } = require('../config/dbManager');

class FullMigration {
  constructor(options = {}) {
    this.bigquery = new BigQuery({
      projectId: process.env.GCP_PROJECT_ID,
      credentials: {
        client_email: process.env.SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
      }
    });

    this.datasetId = process.env.BQ_DATASET_ID || 'survey_data';
    this.dataset = this.bigquery.dataset(this.datasetId);

    this.BATCH_SIZE = 500; // Inserções em lotes de 500
    this.dryRun = options.dryRun || false;
    this.continueOnError = options.continueOnError !== false; // default true
    this.dbKey = options.dbKey || 'telephonic'; // 'telephonic' ou 'f2f'

    this.stats = {
      totalRodadas: 0,
      rodasMigradas: 0,
      rodasComErro: 0,
      questionIndex: 0,
      surveys: 0,
      responses: 0,
      errors: [],
      startTime: null,
      endTime: null,
      rodasDetails: [],
      dbSource: this.dbKey
    };
  }

  /**
   * Verifica quais rodadas já foram migradas no BigQuery
   */
  async checkMigratedRodadas() {
    try {
      const query = `
        SELECT DISTINCT year, rodada, COUNT(*) as count
        FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.responses\`
        GROUP BY year, rodada
        ORDER BY year, rodada
      `;

      const [rows] = await this.bigquery.query({ query });

      const migrated = new Set();
      rows.forEach(r => {
        migrated.add(`${r.year}-${r.rodada}`);
      });

      return migrated;
    } catch (error) {
      console.log('   ⚠️  Não foi possível verificar rodadas migradas (tabela pode estar vazia)');
      return new Set();
    }
  }

  /**
   * Descobre todas as rodadas disponíveis no MongoDB
   */
  async discoverRodadas(skipMigrated = false) {
    console.log(`🔍 Descobrindo rodadas disponíveis no MongoDB [${this.dbKey}]...\n`);

    const Survey = await getModel('Survey', this.dbKey);

    // Buscar todas as combinações únicas de year/month(rodada)
    const rodadas = await Survey.aggregate([
      {
        $group: {
          _id: { year: '$year', rodada: '$month' },
          surveyCount: { $sum: 1 },
          surveyName: { $first: '$name' }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.rodada': 1 }
      }
    ]);

    // Verificar quais já foram migradas
    let migratedRodadas = new Set();
    if (skipMigrated) {
      console.log('🔍 Verificando rodadas já migradas no BigQuery...\n');
      migratedRodadas = await this.checkMigratedRodadas();
      console.log(`✅ Encontradas ${migratedRodadas.size} rodadas já migradas\n`);
    }

    // Contar respostas para cada rodada
    const Response = await getModel('Response', this.dbKey);

    const rodasWithCounts = [];
    const rodasToMigrate = [];
    const rodasSkipped = [];

    for (const rodada of rodadas) {
      const responseCount = await Response.countDocuments({
        year: rodada._id.year,
        rodada: rodada._id.rodada
      });

      const rodadaInfo = {
        year: rodada._id.year,
        rodada: rodada._id.rodada,
        surveyCount: rodada.surveyCount,
        surveyName: rodada.surveyName,
        responseCount
      };

      rodasWithCounts.push(rodadaInfo);

      const rodadaKey = `${rodada._id.year}-${rodada._id.rodada}`;
      if (skipMigrated && migratedRodadas.has(rodadaKey)) {
        rodasSkipped.push(rodadaInfo);
      } else {
        rodasToMigrate.push(rodadaInfo);
      }
    }

    this.stats.totalRodadas = rodasWithCounts.length;

    console.log(`✅ Encontradas ${rodasWithCounts.length} rodadas no total:\n`);

    let totalResponses = 0;
    rodasWithCounts.forEach((r, i) => {
      totalResponses += r.responseCount;
      const status = skipMigrated && rodasSkipped.some(rs => rs.year === r.year && rs.rodada === r.rodada)
        ? '✓ já migrada' : '⏳ pendente';
      console.log(`   ${i + 1}. ${r.year}-R${r.rodada}: ${r.responseCount.toLocaleString()} respostas ${status}`);
    });

    console.log(`\n📊 Total: ${totalResponses.toLocaleString()} documentos de resposta`);

    if (skipMigrated) {
      console.log(`   ✅ Já migradas: ${rodasSkipped.length} rodadas`);
      console.log(`   ⏳ Pendentes: ${rodasToMigrate.length} rodadas\n`);
      return rodasToMigrate;
    }

    console.log('');
    return rodasWithCounts;
  }

  /**
   * Migração completa de todas as rodadas
   */
  async migrateAll(options = {}) {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     MIGRAÇÃO COMPLETA: MongoDB → BigQuery                 ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    if (this.dryRun) {
      console.log('⚠️  MODO DRY-RUN: Nenhum dado será inserido no BigQuery\n');
    }

    if (options.resume) {
      console.log('🔄 MODO RESUME: Continuando de onde parou\n');
    }

    this.stats.startTime = Date.now();

    try {
      // 1. Descobrir todas as rodadas (pular já migradas se resume = true)
      const rodadas = await this.discoverRodadas(options.resume || false);

      if (rodadas.length === 0) {
        console.log('✅ Todas as rodadas já foram migradas! Nada a fazer.\n');
        return;
      }

      // 2. Confirmar se não for dry-run
      if (!this.dryRun && !options.force) {
        console.log('⚠️  CONFIRMAÇÃO NECESSÁRIA!\n');
        console.log(`Isso vai migrar ${rodadas.length} rodadas para o BigQuery`);
        console.log('Use --dry-run para simular ou --force para confirmar\n');
        console.log('Comando com --force:');
        console.log('   npm run bq:migrate-all -- --force\n');
        console.log('Para continuar de onde parou:');
        console.log('   npm run bq:migrate-all -- --force --resume\n');
        return;
      }

      // 3. Migrar índice de perguntas (uma única vez, apenas se não for resume)
      if (!options.resume) {
        await this.migrateAllQuestionIndex();
      } else {
        console.log('⏭️  Pulando migração do Question Index (modo resume)\n');
      }

      // 4. Migrar todas as surveys (apenas se não for resume)
      if (!options.resume) {
        await this.migrateAllSurveys(rodadas);
      } else {
        console.log('⏭️  Pulando migração de Surveys (modo resume)\n');
      }

      // 5. Migrar todas as respostas por rodada
      for (let i = 0; i < rodadas.length; i++) {
        const rodada = rodadas[i];
        console.log(`\n${'='.repeat(70)}`);
        console.log(`📦 Rodada ${i + 1}/${rodadas.length}: ${rodada.year}-R${rodada.rodada}`);
        console.log(`${'='.repeat(70)}\n`);

        try {
          await this.migrateRodadaResponses(rodada.year, rodada.rodada);

          this.stats.rodasMigradas++;
          this.stats.rodasDetails.push({
            year: rodada.year,
            rodada: rodada.rodada,
            status: 'success',
            responseCount: rodada.responseCount
          });

        } catch (error) {
          console.error(`❌ Erro ao migrar rodada ${rodada.year}-R${rodada.rodada}:`, error.message);

          this.stats.rodasComErro++;
          this.stats.errors.push({
            rodada: `${rodada.year}-R${rodada.rodada}`,
            error: error.message
          });

          this.stats.rodasDetails.push({
            year: rodada.year,
            rodada: rodada.rodada,
            status: 'error',
            error: error.message
          });

          if (!this.continueOnError) {
            throw error;
          }
        }
      }

      // 6. Relatório final
      this.stats.endTime = Date.now();
      this.printFinalReport();

      return this.stats;

    } catch (error) {
      console.error('\n❌ Erro fatal durante migração:', error);
      throw error;
    }
  }

  /**
   * Migra TODAS as perguntas de TODAS as rodadas (uma única vez)
   */
  async migrateAllQuestionIndex() {
    console.log(`📋 Migrando TODAS as perguntas do Question Index [${this.dbKey}]...\n`);

    const QuestionIndex = await getModel('QuestionIndex', this.dbKey);

    // Buscar TODAS as perguntas
    const questions = await QuestionIndex.find({}).lean();

    console.log(`   Encontradas ${questions.length.toLocaleString()} perguntas no total`);

    if (questions.length === 0) {
      console.log('⚠️  Nenhuma pergunta encontrada!');
      return;
    }

    if (this.dryRun) {
      console.log(`   [DRY-RUN] Pulando inserção de ${questions.length} perguntas\n`);
      return;
    }

    const rows = questions.map(q => ({
      id: q._id.toString(),
      survey_number: q.surveyNumber,
      survey_name: q.surveyName || '',
      question_code: q.variable,
      question_text: q.questionText || '',
      label: q.label || '',
      theme: q.index || '',
      methodology: q.methodology || '',
      map: q.map || '',
      sample: q.sample || '',
      date: q.date || '',
      possible_answers: (q.possibleAnswers || []).map(a => ({
        value: a.value || '',
        label: a.label || ''
      })),
      created_at: q.createdAt || new Date(),
      updated_at: q.updatedAt || new Date()
    }));

    await this.insertInBatches('question_index', rows);
    this.stats.questionIndex = rows.length;

    console.log(`✅ ${rows.length.toLocaleString()} perguntas migradas\n`);
  }

  /**
   * Migra todas as surveys
   */
  async migrateAllSurveys(rodadas) {
    console.log(`📊 Migrando TODAS as Surveys [${this.dbKey}]...\n`);

    const Survey = await getModel('Survey', this.dbKey);

    // Buscar TODAS as surveys
    const surveys = await Survey.find({}).lean();

    console.log(`   Encontradas ${surveys.length} surveys no total`);

    if (surveys.length === 0) {
      console.log('⚠️  Nenhuma survey encontrada!');
      return;
    }

    if (this.dryRun) {
      console.log(`   [DRY-RUN] Pulando inserção de ${surveys.length} surveys\n`);
      return;
    }

    const rows = surveys.map(s => ({
      id: s._id.toString(),
      name: s.name,
      year: s.year,
      month: s.month,
      file_hashes: s.fileHashes || [],
      created_at: s.createdAt || new Date()
    }));

    await this.insertInBatches('surveys', rows);
    this.stats.surveys = rows.length;

    console.log(`✅ ${rows.length} surveys migradas\n`);
  }

  /**
   * Migra respostas de uma rodada específica
   */
  async migrateRodadaResponses(year, rodada) {
    console.log(`💾 Migrando respostas de ${year}-R${rodada} [${this.dbKey}]...\n`);

    const Response = await getModel('Response', this.dbKey);

    // Contar total primeiro
    const total = await Response.countDocuments({
      year: year,
      rodada: rodada
    });

    console.log(`   Total de documentos: ${total.toLocaleString()}`);

    if (total === 0) {
      console.log('   ⚠️  Nenhuma resposta encontrada para esta rodada\n');
      return;
    }

    if (this.dryRun) {
      console.log(`   [DRY-RUN] Pulando migração de ~${total * 20} respostas\n`);
      return;
    }

    // Estimar tamanho da migração
    const estimatedRows = total * 20; // ~20 respostas por documento
    console.log(`   Respostas estimadas: ${estimatedRows.toLocaleString()}`);

    let processedDocs = 0;
    let batch = [];
    let rodadaResponseCount = 0;
    const startTime = Date.now();

    // Buscar documentos em streaming
    const cursor = Response.find({
      year: year,
      rodada: rodada
    }).cursor();

    for await (const response of cursor) {
      const rows = this.transformResponseToRows(response);
      batch.push(...rows);

      processedDocs++;

      // Inserir quando o batch atingir o tamanho
      if (batch.length >= this.BATCH_SIZE) {
        await this.insertInBatches('responses', batch, false);
        rodadaResponseCount += batch.length;

        // Progress update
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = Math.round(processedDocs / elapsed);
        const progress = ((processedDocs / total) * 100).toFixed(1);
        console.log(`   📈 ${progress}% | ${processedDocs}/${total} docs | ${rodadaResponseCount.toLocaleString()} respostas | ${rate} docs/s`);

        batch = [];
      }
    }

    // Inserir últimas respostas
    if (batch.length > 0) {
      await this.insertInBatches('responses', batch, false);
      rodadaResponseCount += batch.length;
    }

    this.stats.responses += rodadaResponseCount;

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n   ✅ ${rodadaResponseCount.toLocaleString()} respostas migradas em ${totalTime}s\n`);
  }

  /**
   * Transforma um documento Response em múltiplas rows do BigQuery
   */
  transformResponseToRows(response) {
    const rows = [];
    const demographics = this.extractDemographics(response.answers);
    const weight = this.extractWeight(response.answers);

    // Cada answer vira uma row
    for (const answer of response.answers) {
      // Pular campos demográficos e weights
      if (this.isDemographicField(answer.k) || answer.k.toLowerCase().includes('weight')) {
        continue;
      }

      rows.push({
        response_id: `${response._id}_${answer.k}`,
        survey_id: response.surveyId.toString(),
        entrevistado_id: response.entrevistadoId,
        question_code: answer.k,
        answer_value: answer.v?.toString() || null,
        year: response.year,
        rodada: response.rodada,
        theme: null, // Será preenchido via JOIN com question_index
        weight: weight,
        ...demographics,
        created_at: response.createdAt || new Date()
      });
    }

    return rows;
  }

  /**
   * Extrai campos demográficos das respostas
   */
  extractDemographics(answers) {
    const demo = {
      uf: null,
      regiao: null,
      pf1: null,
      pf2_1: null,
      pf2_faixas: null,
      pf3: null,
      pf4: null,
      pf5: null,
      pf6: null,
      pf7: null,
      pf8: null,
      pf9: null,
      pf10: null
    };

    for (const answer of answers) {
      const key = answer.k.toLowerCase();
      if (key === 'uf') demo.uf = answer.v?.toString();
      else if (key === 'regiao') demo.regiao = answer.v?.toString();
      else if (key === 'pf1') demo.pf1 = answer.v?.toString();
      else if (key === 'pf2#1' || key === 'pf2_1') demo.pf2_1 = answer.v?.toString();
      else if (key === 'pf2_faixas') demo.pf2_faixas = answer.v?.toString();
      else if (key === 'pf3') demo.pf3 = answer.v?.toString();
      else if (key === 'pf4') demo.pf4 = answer.v?.toString();
      else if (key === 'pf5') demo.pf5 = answer.v?.toString();
      else if (key === 'pf6') demo.pf6 = answer.v?.toString();
      else if (key === 'pf7') demo.pf7 = answer.v?.toString();
      else if (key === 'pf8') demo.pf8 = answer.v?.toString();
      else if (key === 'pf9') demo.pf9 = answer.v?.toString();
      else if (key === 'pf10') demo.pf10 = answer.v?.toString();
    }

    return demo;
  }

  /**
   * Extrai weight das respostas
   */
  extractWeight(answers) {
    const weightAnswer = answers.find(a =>
      a.k.toLowerCase().includes('weight')
    );

    if (!weightAnswer || !weightAnswer.v) return 1.0;

    const weightStr = weightAnswer.v.toString().replace(',', '.');
    const weight = parseFloat(weightStr);

    return isNaN(weight) ? 1.0 : weight;
  }

  /**
   * Verifica se é um campo demográfico
   */
  isDemographicField(key) {
    const demoFields = ['uf', 'regiao', 'pf1', 'pf2#1', 'pf2_1', 'pf2_faixas',
                        'pf3', 'pf4', 'pf5', 'pf6', 'pf7', 'pf8', 'pf9', 'pf10'];
    return demoFields.includes(key.toLowerCase());
  }

  /**
   * Insere dados em lotes no BigQuery
   */
  async insertInBatches(tableName, rows, showProgress = true) {
    if (this.dryRun) {
      if (showProgress) {
        console.log(`   [DRY-RUN] Pulando inserção de ${rows.length} rows em ${tableName}`);
      }
      return;
    }

    const table = this.dataset.table(tableName);
    const chunks = this.chunkArray(rows, this.BATCH_SIZE);

    for (let i = 0; i < chunks.length; i++) {
      try {
        await table.insert(chunks[i], {
          skipInvalidRows: false,
          ignoreUnknownValues: false,
        });

        if (showProgress) {
          console.log(`   ✓ Lote ${i + 1}/${chunks.length} inserido (${chunks[i].length} rows)`);
        }
      } catch (error) {
        console.error(`   ❌ Erro no lote ${i + 1}:`, error.message);

        if (error.errors && error.errors.length > 0) {
          console.error('   Detalhes:', error.errors[0]);
        }

        this.stats.errors.push({
          table: tableName,
          batch: i + 1,
          error: error.message
        });

        if (!this.continueOnError) {
          throw error;
        }
      }
    }
  }

  /**
   * Divide array em chunks
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Limpa uma rodada específica do BigQuery
   */
  async cleanRodada(year, rodada) {
    console.log(`🧹 Limpando rodada ${year}-R${rodada} do BigQuery...\n`);

    try {
      // Contar antes
      const countQuery = `
        SELECT COUNT(*) as total
        FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.responses\`
        WHERE year = @year AND rodada = @rodada
      `;

      const [countResult] = await this.bigquery.query({
        query: countQuery,
        params: { year, rodada }
      });

      const beforeCount = countResult[0]?.total || 0;
      console.log(`   📊 Respostas encontradas: ${beforeCount.toLocaleString()}`);

      if (beforeCount === 0) {
        console.log('   ⚠️  Nenhuma resposta encontrada para esta rodada\n');
        return;
      }

      // Deletar
      const deleteQuery = `
        DELETE FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.responses\`
        WHERE year = @year AND rodada = @rodada
      `;

      const [job] = await this.bigquery.createQueryJob({
        query: deleteQuery,
        params: { year, rodada }
      });

      await job.getQueryResults();
      console.log(`   ✅ ${beforeCount.toLocaleString()} respostas removidas\n`);

    } catch (error) {
      console.error(`❌ Erro ao limpar rodada:`, error.message);
      throw error;
    }
  }

  /**
   * Re-migra uma rodada específica (limpa e migra novamente)
   */
  async remigrateRodada(year, rodada) {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log(`║  RE-MIGRAÇÃO DE RODADA: ${year}-R${rodada}                     ║`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    try {
      // 1. Limpar rodada existente
      await this.cleanRodada(year, rodada);

      // 2. Migrar novamente
      console.log(`🔄 Iniciando re-migração da rodada ${year}-R${rodada}...\n`);
      await this.migrateRodadaResponses(year, rodada);

      console.log('\n' + '='.repeat(70));
      console.log('✅ RE-MIGRAÇÃO CONCLUÍDA COM SUCESSO!');
      console.log('='.repeat(70) + '\n');

    } catch (error) {
      console.error('\n❌ Erro durante re-migração:', error);
      throw error;
    }
  }

  /**
   * Imprime relatório final detalhado
   */
  printFinalReport() {
    const duration = ((this.stats.endTime - this.stats.startTime) / 1000 / 60).toFixed(2);

    console.log('\n' + '='.repeat(70));
    console.log('📊 RELATÓRIO FINAL DE MIGRAÇÃO COMPLETA');
    console.log('='.repeat(70));

    if (this.dryRun) {
      console.log('⚠️  MODO DRY-RUN - Nenhum dado foi inserido\n');
    }

    console.log(`⏱️  Duração total: ${duration} minutos\n`);

    console.log('📈 ESTATÍSTICAS:');
    console.log(`   Rodadas processadas: ${this.stats.rodasMigradas}/${this.stats.totalRodadas}`);
    console.log(`   Rodadas com erro:    ${this.stats.rodasComErro}\n`);

    console.log('📊 DADOS MIGRADOS:');
    console.log(`   ✅ Question Index:  ${this.stats.questionIndex.toLocaleString()} registros`);
    console.log(`   ✅ Surveys:         ${this.stats.surveys.toLocaleString()} registros`);
    console.log(`   ✅ Responses:       ${this.stats.responses.toLocaleString()} registros\n`);

    if (this.stats.errors.length > 0) {
      console.log('❌ ERROS ENCONTRADOS:');
      this.stats.errors.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.rodada || err.table}: ${err.error}`);
      });
      console.log('');
    }

    console.log('📋 DETALHES POR RODADA:');
    const successRodadas = this.stats.rodasDetails.filter(r => r.status === 'success');
    const errorRodadas = this.stats.rodasDetails.filter(r => r.status === 'error');

    console.log(`   ✅ Sucesso: ${successRodadas.length} rodadas`);
    successRodadas.forEach(r => {
      console.log(`      - ${r.year}-R${r.rodada}: ${r.responseCount?.toLocaleString() || 'N/A'} docs`);
    });

    if (errorRodadas.length > 0) {
      console.log(`\n   ❌ Erro: ${errorRodadas.length} rodadas`);
      errorRodadas.forEach(r => {
        console.log(`      - ${r.year}-R${r.rodada}: ${r.error}`);
      });
    }

    console.log('='.repeat(70));

    if (!this.dryRun) {
      console.log('\n✅ Migração completa finalizada!');
      console.log('\n📝 Próximos passos:');
      console.log('   1. Verifique os dados no BigQuery Console');
      console.log('   2. Execute: npm run bq:test');
      console.log('   3. Execute: npm run bq:costs');
      console.log('   4. Compare performance com MongoDB\n');
    } else {
      console.log('\n✅ Simulação (dry-run) concluída!');
      console.log('\n📝 Para executar a migração real:');
      console.log('   npm run bq:migrate-all -- --force\n');
    }
  }
}

// ==================== SCRIPT PRINCIPAL ====================

async function main() {
  const args = process.argv.slice(2);

  // Determinar fonte de dados (telephonic ou f2f)
  const dbKey = args.includes('--f2f') ? 'f2f' : 'telephonic';
  const dbName = dbKey === 'f2f' ? 'Face-to-Face' : 'Telefônico';

  // Verificar se é comando de re-migração de rodada específica
  if (args[0] === 'remigrate') {
    const year = parseInt(args[1]);
    const rodada = parseInt(args[2]);

    if (!year || !rodada) {
      console.log('❌ Erro: Ano e rodada são obrigatórios\n');
      console.log('Uso: npm run bq:migrate-all -- remigrate <ano> <rodada> [--f2f]\n');
      console.log('Exemplos:\n');
      console.log('   npm run bq:migrate-all -- remigrate 2025 44');
      console.log('   npm run bq:migrate-all -- remigrate 2025 1 --f2f\n');
      process.exit(1);
    }

    const migration = new FullMigration({ dryRun: false, dbKey });
    await migration.remigrateRodada(year, rodada);
    return;
  }

  const options = {
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    resume: args.includes('--resume'),
    continueOnError: !args.includes('--stop-on-error'),
    dbKey: dbKey
  };

  const migration = new FullMigration(options);

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log(`║     MIGRAÇÃO COMPLETA: MongoDB → BigQuery [${dbName}]      ║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  if (options.dryRun) {
    console.log('🔍 Modo DRY-RUN ativado - apenas simulação\n');
  }

  if (options.resume) {
    console.log('🔄 Modo RESUME ativado - continuando de onde parou\n');
  }

  if (dbKey === 'f2f') {
    console.log('👥 Fonte de dados: Face-to-Face (Presencial)\n');
  } else {
    console.log('📞 Fonte de dados: Telefônico\n');
  }

  await migration.migrateAll(options);
}

// Executar se chamado diretamente
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n❌ Erro fatal:', error);
      console.error('\n📋 Stack trace:', error.stack);
      process.exit(1);
    });
}

module.exports = FullMigration;
