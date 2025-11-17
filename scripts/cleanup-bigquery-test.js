// scripts/cleanup-bigquery-test.js
require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');

class BigQueryCleanup {
  constructor() {
    this.bigquery = new BigQuery({
      projectId: process.env.GCP_PROJECT_ID,
      credentials: {
        client_email: process.env.SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
      }
    });
    
    this.datasetId = process.env.BQ_DATASET_ID || 'survey_data';
  }

  /**
   * Remove dados de teste específicos
   */
  async cleanTestData(year, rodada) {
    console.log('🧹 LIMPEZA DE DADOS DE TESTE\n');
    console.log(`📅 Removendo dados: Ano ${year}, Rodada ${rodada}\n`);

    const tables = [
      { name: 'responses', filter: 'year = @year AND rodada = @rodada' },
      { name: 'question_index', filter: 'survey_number = @surveyNumber' },
      { name: 'surveys', filter: 'year = @year AND month = @rodada' }
    ];

    let totalDeleted = 0;

    for (const table of tables) {
      try {
        console.log(`🗑️  Limpando tabela: ${table.name}`);

        // Contar registros antes
        const countQuery = `
          SELECT COUNT(*) as total
          FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.${table.name}\`
          WHERE ${table.filter}
        `;

        const [countResult] = await this.bigquery.query({
          query: countQuery,
          params: { 
            year: year, 
            rodada: rodada,
            surveyNumber: rodada.toString()
          }
        });

        const beforeCount = countResult[0]?.total || 0;
        console.log(`   📊 Registros encontrados: ${beforeCount.toLocaleString()}`);

        if (beforeCount === 0) {
          console.log(`   ✓ Nada para limpar\n`);
          continue;
        }

        // Deletar
        const deleteQuery = `
          DELETE FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.${table.name}\`
          WHERE ${table.filter}
        `;

        const [job] = await this.bigquery.createQueryJob({
          query: deleteQuery,
          params: { 
            year: year, 
            rodada: rodada,
            surveyNumber: rodada.toString()
          }
        });

        await job.getQueryResults();

        console.log(`   ✅ ${beforeCount.toLocaleString()} registros removidos\n`);
        totalDeleted += beforeCount;

      } catch (error) {
        console.error(`   ❌ Erro ao limpar ${table.name}:`, error.message);
      }
    }

    console.log('='.repeat(70));
    console.log(`✅ Limpeza concluída: ${totalDeleted.toLocaleString()} registros removidos`);
    console.log('='.repeat(70) + '\n');
  }

  /**
   * Remove TODOS os dados de teste (todas as rodadas antes de uma data)
   */
  async cleanAllTestData(beforeYear = 2024) {
    console.log('🧹 LIMPEZA COMPLETA DE DADOS DE TESTE\n');
    console.log(`⚠️  ATENÇÃO: Isso vai remover TODOS os dados antes de ${beforeYear}!\n`);

    const tables = ['responses', 'question_index', 'surveys'];
    let totalDeleted = 0;

    for (const tableName of tables) {
      try {
        console.log(`🗑️  Limpando tabela: ${tableName}`);

        // Contar registros
        let countQuery;
        if (tableName === 'question_index') {
          countQuery = `SELECT COUNT(*) as total FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.${tableName}\``;
        } else {
          countQuery = `
            SELECT COUNT(*) as total
            FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.${tableName}\`
            WHERE year < @beforeYear
          `;
        }

        const [countResult] = await this.bigquery.query({
          query: countQuery,
          params: { beforeYear }
        });

        const beforeCount = countResult[0]?.total || 0;
        console.log(`   📊 Registros encontrados: ${beforeCount.toLocaleString()}`);

        if (beforeCount === 0) {
          console.log(`   ✓ Nada para limpar\n`);
          continue;
        }

        // Deletar
        let deleteQuery;
        if (tableName === 'question_index') {
          // Para question_index, não tem year, então limpa tudo
          console.log(`   ⚠️  Question Index não tem campo year - pulando`);
          continue;
        } else {
          deleteQuery = `
            DELETE FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.${tableName}\`
            WHERE year < @beforeYear
          `;
        }

        const [job] = await this.bigquery.createQueryJob({
          query: deleteQuery,
          params: { beforeYear }
        });

        await job.getQueryResults();

        console.log(`   ✅ ${beforeCount.toLocaleString()} registros removidos\n`);
        totalDeleted += beforeCount;

      } catch (error) {
        console.error(`   ❌ Erro ao limpar ${tableName}:`, error.message);
      }
    }

    console.log('='.repeat(70));
    console.log(`✅ Limpeza total concluída: ${totalDeleted.toLocaleString()} registros removidos`);
    console.log('='.repeat(70) + '\n');
  }

  /**
   * Remove TODAS as tabelas completamente (TRUNCATE)
   */
  async cleanAllTables() {
    console.log('🧹 LIMPEZA TOTAL DE TODAS AS TABELAS\n');
    console.log('⚠️  ATENÇÃO: Isso vai remover TODOS os dados de TODAS as tabelas!\n');

    const tables = ['responses', 'question_index', 'surveys'];
    let totalDeleted = 0;

    for (const tableName of tables) {
      try {
        console.log(`🗑️  Limpando tabela: ${tableName}`);

        // Contar registros antes
        const countQuery = `
          SELECT COUNT(*) as total
          FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.${tableName}\`
        `;

        const [countResult] = await this.bigquery.query({ query: countQuery });
        const beforeCount = countResult[0]?.total || 0;

        console.log(`   📊 Registros encontrados: ${beforeCount.toLocaleString()}`);

        if (beforeCount === 0) {
          console.log(`   ✓ Tabela já está vazia\n`);
          continue;
        }

        // Deletar TUDO (TRUNCATE não é suportado no BigQuery, então usamos DELETE sem WHERE)
        const deleteQuery = `
          DELETE FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.${tableName}\`
          WHERE TRUE
        `;

        const [job] = await this.bigquery.createQueryJob({ query: deleteQuery });
        await job.getQueryResults();

        console.log(`   ✅ ${beforeCount.toLocaleString()} registros removidos\n`);
        totalDeleted += beforeCount;

      } catch (error) {
        console.error(`   ❌ Erro ao limpar ${tableName}:`, error.message);
      }
    }

    console.log('='.repeat(70));
    console.log(`✅ Limpeza total concluída: ${totalDeleted.toLocaleString()} registros removidos`);
    console.log('='.repeat(70) + '\n');
  }

  /**
   * Lista dados existentes no BigQuery
   */
  async listData() {
    console.log('📊 DADOS ATUAIS NO BIGQUERY\n');

    const tables = ['responses', 'question_index', 'surveys'];

    for (const tableName of tables) {
      try {
        console.log(`📋 ${tableName.toUpperCase()}`);
        console.log('-'.repeat(70));

        // Contar total
        const countQuery = `
          SELECT COUNT(*) as total
          FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.${tableName}\`
        `;

        const [countResult] = await this.bigquery.query({ query: countQuery });
        const total = countResult[0]?.total || 0;

        console.log(`   Total: ${total.toLocaleString()} registros`);

        // Distribuição por ano/rodada (se aplicável)
        if (tableName === 'responses' || tableName === 'surveys') {
          const distQuery = `
            SELECT 
              year,
              ${tableName === 'responses' ? 'rodada' : 'month as rodada'},
              COUNT(*) as count
            FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.${tableName}\`
            GROUP BY year, rodada
            ORDER BY year DESC, rodada DESC
            LIMIT 10
          `;

          const [distResult] = await this.bigquery.query({ query: distQuery });

          if (distResult.length > 0) {
            console.log(`\n   Distribuição (últimas 10):`);
            distResult.forEach(r => {
              console.log(`      ${r.year} - Rodada ${r.rodada}: ${r.count.toLocaleString()}`);
            });
          }
        } else if (tableName === 'question_index') {
          const distQuery = `
            SELECT 
              survey_number,
              COUNT(*) as count
            FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.${tableName}\`
            GROUP BY survey_number
            ORDER BY CAST(survey_number AS INT64) DESC
            LIMIT 10
          `;

          const [distResult] = await this.bigquery.query({ query: distQuery });

          if (distResult.length > 0) {
            console.log(`\n   Distribuição por rodada (últimas 10):`);
            distResult.forEach(r => {
              console.log(`      Rodada ${r.survey_number}: ${r.count.toLocaleString()} perguntas`);
            });
          }
        }

        console.log('\n');

      } catch (error) {
        console.error(`❌ Erro ao listar ${tableName}:`, error.message);
      }
    }
  }

  /**
   * Calcula tamanho e custo estimado
   */
  async calculateSize() {
    console.log('💰 TAMANHO E CUSTO ESTIMADO\n');

    try {
      const query = `
        SELECT 
          table_name,
          ROUND(size_bytes/1024/1024, 2) as size_mb,
          ROUND(size_bytes/1024/1024/1024, 4) as size_gb,
          row_count
        FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.__TABLES__\`
        ORDER BY size_bytes DESC
      `;

      const [results] = await this.bigquery.query({ query });

      console.log('┌────────────────────┬──────────────┬──────────────┬────────────────┐');
      console.log('│ Tabela             │ Tamanho (MB) │ Tamanho (GB) │ Linhas         │');
      console.log('├────────────────────┼──────────────┼──────────────┼────────────────┤');

      let totalMB = 0;
      let totalRows = 0;

      results.forEach(r => {
        totalMB += parseFloat(r.size_mb);
        totalRows += parseInt(r.row_count);

        const table = r.table_name.padEnd(18);
        const sizeMB = r.size_mb.toString().padStart(12);
        const sizeGB = r.size_gb.toString().padStart(12);
        const rows = r.row_count.toLocaleString().padStart(14);

        console.log(`│ ${table} │ ${sizeMB} │ ${sizeGB} │ ${rows} │`);
      });

      console.log('├────────────────────┼──────────────┼──────────────┼────────────────┤');
      const totalGb = (totalMB / 1024).toFixed(4);
      console.log(`│ ${'TOTAL'.padEnd(18)} │ ${totalMB.toFixed(2).padStart(12)} │ ${totalGb.padStart(12)} │ ${totalRows.toLocaleString().padStart(14)} │`);
      console.log('└────────────────────┴──────────────┴──────────────┴────────────────┘\n');

      // Calcular custos
      const storageCostPerGB = 0.02; // $0.02 por GB/mês
      const monthlyCost = parseFloat(totalGb) * storageCostPerGB;

      console.log('💰 Custos estimados:');
      console.log(`   Storage: $${monthlyCost.toFixed(4)}/mês ($0.02/GB)`);
      console.log(`   Queries: ~$0.01-0.10/mês (depende do uso)\n`);

    } catch (error) {
      console.error('❌ Erro ao calcular tamanho:', error.message);
    }
  }
}

// ==================== SCRIPT PRINCIPAL ====================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const cleanup = new BigQueryCleanup();

  switch (command) {
    case 'clean':
      // Limpar rodada específica
      const year = parseInt(args[1]) || 2023;
      const rodada = parseInt(args[2]) || 1;
      await cleanup.cleanTestData(year, rodada);
      break;

    case 'clean-all':
      // Limpar todos os dados de teste
      const beforeYear = parseInt(args[1]) || 2024;

      console.log('⚠️  CONFIRMAÇÃO NECESSÁRIA!\n');
      console.log(`Isso vai remover TODOS os dados antes de ${beforeYear}`);
      console.log('Digite "CONFIRMAR" para continuar ou Ctrl+C para cancelar\n');

      // Em produção, você deveria usar readline para confirmar
      // Por enquanto, requer passar --force
      if (args[2] === '--force') {
        await cleanup.cleanAllTestData(beforeYear);
      } else {
        console.log('❌ Operação cancelada. Use --force para confirmar:\n');
        console.log(`   npm run bq:clean-all ${beforeYear} --force\n`);
      }
      break;

    case 'clean-all-tables':
      // Limpar TODAS as tabelas completamente
      console.log('⚠️  CONFIRMAÇÃO NECESSÁRIA!\n');
      console.log('Isso vai remover TODOS os dados de TODAS as tabelas (responses, question_index, surveys)');
      console.log('Esta operação é IRREVERSÍVEL!\n');

      if (args[1] === '--force') {
        await cleanup.cleanAllTables();
      } else {
        console.log('❌ Operação cancelada. Use --force para confirmar:\n');
        console.log('   npm run bq:cleanup -- clean-all-tables --force\n');
      }
      break;

    case 'list':
      // Listar dados
      await cleanup.listData();
      break;

    case 'size':
      // Calcular tamanho
      await cleanup.calculateSize();
      break;

    default:
      console.log('📋 USO:\n');
      console.log('   npm run bq:cleanup -- clean <ano> <rodada>      - Limpa rodada específica');
      console.log('   npm run bq:cleanup -- clean-all <ano> --force   - Limpa todos antes do ano');
      console.log('   npm run bq:cleanup -- clean-all-tables --force  - Limpa TODAS as tabelas');
      console.log('   npm run bq:cleanup -- list                      - Lista dados atuais');
      console.log('   npm run bq:cleanup -- size                      - Mostra tamanho e custos\n');
      console.log('Exemplos:\n');
      console.log('   npm run bq:cleanup -- clean 2023 1');
      console.log('   npm run bq:cleanup -- clean-all 2024 --force');
      console.log('   npm run bq:cleanup -- clean-all-tables --force');
      console.log('   npm run bq:cleanup -- list');
      console.log('   npm run bq:cleanup -- size\n');
  }
}

// Executar
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n❌ Erro fatal:', error);
      process.exit(1);
    });
}

module.exports = BigQueryCleanup;