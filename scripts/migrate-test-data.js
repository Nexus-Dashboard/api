// scripts/migrate-test-data.js
require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');
const { getModel } = require('../config/dbManager');

class TestMigration {
  constructor() {
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
    this.stats = {
      responses: 0,
      questionIndex: 0,
      surveys: 0,
      errors: 0
    };
  }

  /**
   * Migra apenas uma rodada específica para teste
   */
  async migrateTestRodada(year = 2025, rodada = 1) {
    console.log('🚀 Iniciando migração de teste...');
    console.log(`📅 Rodada selecionada: ${year} - Rodada ${rodada}\n`);

    try {
      // 1. Migrar índice de perguntas
      await this.migrateQuestionIndex(year, rodada);
      
      // 2. Migrar pesquisas (surveys)
      await this.migrateSurveys(year, rodada);
      
      // 3. Migrar respostas
      await this.migrateResponses(year, rodada);
      
      // 4. Relatório final
      this.printReport();
      
      return true;
    } catch (error) {
      console.error('❌ Erro durante migração:', error);
      throw error;
    }
  }

  /**
   * Migra o índice de perguntas
   */
  async migrateQuestionIndex(year, rodada) {
    console.log('📋 Migrando Question Index...');
    
    const QuestionIndex = await getModel('QuestionIndex', 'telephonic');
    
    // Primeiro tentar com o formato "Rodada 01"
    let questions = await QuestionIndex.find({
      surveyNumber: `Rodada ${rodada.toString().padStart(2, '0')}`
    }).lean();

    // Se não encontrar, tentar apenas o número
    if (questions.length === 0) {
      questions = await QuestionIndex.find({
        surveyNumber: rodada.toString()
      }).lean();
    }

    // Se ainda não encontrar, tentar com número sem padding
    if (questions.length === 0) {
      questions = await QuestionIndex.find({
        surveyNumber: `Rodada ${rodada}`
      }).lean();
    }

    console.log(`   Encontradas ${questions.length} perguntas`);
    
    // Debug: mostrar alguns exemplos de surveyNumber se encontrou
    if (questions.length > 0) {
      console.log(`   📋 Formato encontrado: "${questions[0].surveyNumber}"`);
    } else {
      // Buscar qualquer registro para ver o formato
      const sample = await QuestionIndex.findOne().lean();
      if (sample) {
        console.log(`   ⚠️  Formato esperado no banco: "${sample.surveyNumber}"`);
        console.log(`   💡 Tente usar: npm run bq:migrate ${year} ${sample.surveyNumber}`);
      }
    }

    if (questions.length === 0) {
      console.log('⚠️  Nenhuma pergunta encontrada para esta rodada');
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
    
    console.log(`✅ ${rows.length} perguntas migradas\n`);
  }

  /**
   * Migra surveys
   */
  async migrateSurveys(year, rodada) {
    console.log('📊 Migrando Surveys...');
    
    const Survey = await getModel('Survey', 'telephonic');
    
    const surveys = await Survey.find({
      year: year,
      month: rodada
    }).lean();

    console.log(`   Encontradas ${surveys.length} surveys`);

    if (surveys.length === 0) {
      console.log('⚠️  Nenhuma survey encontrada para esta rodada');
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
   * Migra respostas (responses)
   */
  async migrateResponses(year, rodada) {
    console.log('💾 Migrando Responses (pode demorar)...');
    
    const Response = await getModel('Response', 'telephonic');
    
    // Contar total primeiro
    const total = await Response.countDocuments({
      year: year,
      rodada: rodada
    });

    console.log(`   Total de documentos: ${total.toLocaleString()}`);

    if (total === 0) {
      console.log('⚠️  Nenhuma resposta encontrada para esta rodada');
      return;
    }

    // Estimar tamanho da migração
    const estimatedRows = total * 20; // ~20 respostas por documento
    console.log(`   Respostas estimadas: ${estimatedRows.toLocaleString()}`);
    console.log(`   Tempo estimado: ${Math.ceil(estimatedRows / this.BATCH_SIZE / 2)} segundos\n`);

    let processedDocs = 0;
    let batch = [];
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

      // Inserir quando o batch atingir o tamanho ou a cada 100 docs
      if (batch.length >= this.BATCH_SIZE) {
        await this.insertInBatches('responses', batch, false);
        this.stats.responses += batch.length;
        
        // Progress update
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = Math.round(processedDocs / elapsed);
        console.log(`   📈 Progresso: ${processedDocs}/${total} docs | ${this.stats.responses.toLocaleString()} respostas | ${rate} docs/s`);
        
        batch = [];
      }
    }

    // Inserir últimas respostas
    if (batch.length > 0) {
      await this.insertInBatches('responses', batch, false);
      this.stats.responses += batch.length;
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ ${this.stats.responses.toLocaleString()} respostas migradas em ${totalTime}s\n`);
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
        
        this.stats.errors += chunks[i].length;
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
   * Imprime relatório final
   */
  printReport() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 RELATÓRIO DE MIGRAÇÃO DE TESTE');
    console.log('='.repeat(60));
    console.log(`✅ Question Index:  ${this.stats.questionIndex.toLocaleString()} registros`);
    console.log(`✅ Surveys:         ${this.stats.surveys.toLocaleString()} registros`);
    console.log(`✅ Responses:       ${this.stats.responses.toLocaleString()} registros`);
    
    if (this.stats.errors > 0) {
      console.log(`❌ Erros:           ${this.stats.errors.toLocaleString()} registros`);
    }
    
    console.log('='.repeat(60));
    console.log('\n✅ Migração de teste concluída!');
    console.log('\n📝 Próximos passos:');
    console.log('   1. Verifique os dados no BigQuery Console');
    console.log('   2. Execute queries de teste');
    console.log('   3. Compare performance com MongoDB');
    console.log('   4. Execute: node scripts/test-bigquery-queries.js\n');
  }

  /**
   * Limpa dados de teste (útil para refazer testes)
   */
  async cleanTestData(year, rodada) {
    console.log('🧹 Limpando dados de teste...\n');

    const tables = ['responses', 'question_index', 'surveys'];

    for (const tableName of tables) {
      try {
        const query = `
          DELETE FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.${tableName}\`
          WHERE year = @year AND rodada = @rodada
        `;

        const [job] = await this.bigquery.createQueryJob({
          query: query,
          params: { year, rodada }
        });

        await job.getQueryResults();
        console.log(`✅ Tabela ${tableName} limpa`);
      } catch (error) {
        console.error(`❌ Erro ao limpar ${tableName}:`, error.message);
      }
    }

    console.log('\n✅ Limpeza concluída\n');
  }
}

// ==================== SCRIPT PRINCIPAL ====================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const migration = new TestMigration();

  if (command === 'clean') {
    // Limpar dados de teste
    const year = parseInt(args[1]) || 2025;
    const rodada = parseInt(args[2]) || 1;
    await migration.cleanTestData(year, rodada);
  } else {
    // Migração normal
    const year = parseInt(args[0]) || 2025;
    const rodada = parseInt(args[1]) || 1;
    
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     MIGRAÇÃO DE TESTE: MongoDB → BigQuery                 ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    await migration.migrateTestRodada(year, rodada);
  }
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

module.exports = TestMigration;