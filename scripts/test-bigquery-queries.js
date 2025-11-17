// scripts/test-bigquery-queries.js
require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');
const { getModel } = require('../config/dbManager');

class PerformanceTest {
  constructor() {
    this.bigquery = new BigQuery({
      projectId: process.env.GCP_PROJECT_ID,
      credentials: {
        client_email: process.env.SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
      }
    });
    
    this.datasetId = process.env.BQ_DATASET_ID || 'survey_data';
    this.results = [];
  }

  /**
   * Executa todos os testes
   */
  async runAllTests(questionCode = 'P1', theme = 'Político', year = 2025, rodada = 1) {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║    TESTE DE PERFORMANCE: MongoDB vs BigQuery              ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log(`🎯 Configuração do teste:`);
    console.log(`   Pergunta: ${questionCode}`);
    console.log(`   Tema: ${theme}`);
    console.log(`   Ano: ${year}`);
    console.log(`   Rodada: ${rodada}\n`);

    // Teste 1: Busca simples de respostas
    await this.test1_SimpleQuery(questionCode, year, rodada);
    
    // Teste 2: Agregação com demographics
    await this.test2_AggregationWithDemographics(questionCode, year, rodada);
    
    // Teste 3: Busca por tema
    await this.test3_ThemeQuery(theme);
    
    // Teste 4: Análise de série temporal
    await this.test4_TimeSeriesAnalysis(questionCode);
    
    // Teste 5: Contagem total
    await this.test5_CountQuery(year, rodada);

    // Relatório final
    this.printReport();
  }

  /**
   * TESTE 1: Busca simples de respostas
   */
  async test1_SimpleQuery(questionCode, year, rodada) {
    console.log('📊 TESTE 1: Busca simples de respostas\n');

    // MongoDB
    const mongoStart = Date.now();
    const Response = await getModel('Response', 'telephonic');
    const mongoResults = await Response.aggregate([
      {
        $match: {
          year: year,
          rodada: rodada,
          'answers.k': questionCode
        }
      },
      { $limit: 1000 }
    ]);
    const mongoTime = Date.now() - mongoStart;
    const mongoCount = mongoResults.length;

    console.log(`   MongoDB: ${mongoTime}ms | ${mongoCount} resultados`);

    // BigQuery
    const bqStart = Date.now();
    const query = `
      SELECT 
        question_code,
        answer_value,
        year,
        rodada
      FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.responses\`
      WHERE 
        question_code = @questionCode
        AND year = @year
        AND rodada = @rodada
      LIMIT 1000
    `;

    const [bqResults] = await this.bigquery.query({
      query: query,
      params: { questionCode, year, rodada }
    });
    const bqTime = Date.now() - bqStart;
    const bqCount = bqResults.length;

    console.log(`   BigQuery: ${bqTime}ms | ${bqCount} resultados`);
    
    const speedup = ((mongoTime / bqTime) * 100 - 100).toFixed(1);
    console.log(`   🚀 BigQuery foi ${Math.abs(speedup)}% ${speedup > 0 ? 'mais rápido' : 'mais lento'}\n`);

    this.results.push({
      test: 'Busca Simples',
      mongo: mongoTime,
      bigquery: bqTime,
      speedup: speedup
    });
  }

  /**
   * TESTE 2: Agregação com demographics
   */
  async test2_AggregationWithDemographics(questionCode, year, rodada) {
    console.log('📊 TESTE 2: Agregação com demographics\n');

    // MongoDB
    const mongoStart = Date.now();
    const Response = await getModel('Response', 'telephonic');
    const mongoResults = await Response.aggregate([
      {
        $match: {
          year: year,
          rodada: rodada,
          'answers.k': questionCode
        }
      },
      {
        $project: {
          mainAnswer: {
            $let: {
              vars: {
                ans: {
                  $filter: {
                    input: '$answers',
                    cond: { $eq: ['$$this.k', questionCode] }
                  }
                }
              },
              in: { $arrayElemAt: ['$$ans.v', 0] }
            }
          },
          uf: {
            $let: {
              vars: {
                ans: {
                  $filter: {
                    input: '$answers',
                    cond: { $eq: ['$$this.k', 'UF'] }
                  }
                }
              },
              in: { $arrayElemAt: ['$$ans.v', 0] }
            }
          }
        }
      },
      {
        $group: {
          _id: { answer: '$mainAnswer', uf: '$uf' },
          count: { $sum: 1 }
        }
      }
    ]);
    const mongoTime = Date.now() - mongoStart;

    console.log(`   MongoDB: ${mongoTime}ms | ${mongoResults.length} grupos`);

    // BigQuery
    const bqStart = Date.now();
    const query = `
      SELECT 
        answer_value,
        uf,
        COUNT(*) as count,
        SUM(weight) as weighted_count
      FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.responses\`
      WHERE 
        question_code = @questionCode
        AND year = @year
        AND rodada = @rodada
      GROUP BY answer_value, uf
      ORDER BY weighted_count DESC
    `;

    const [bqResults] = await this.bigquery.query({
      query: query,
      params: { questionCode, year, rodada }
    });
    const bqTime = Date.now() - bqStart;

    console.log(`   BigQuery: ${bqTime}ms | ${bqResults.length} grupos`);
    
    const speedup = ((mongoTime / bqTime) * 100 - 100).toFixed(1);
    console.log(`   🚀 BigQuery foi ${Math.abs(speedup)}% ${speedup > 0 ? 'mais rápido' : 'mais lento'}\n`);

    this.results.push({
      test: 'Agregação com Demographics',
      mongo: mongoTime,
      bigquery: bqTime,
      speedup: speedup
    });
  }

  /**
   * TESTE 3: Busca por tema
   */
  async test3_ThemeQuery(theme) {
    console.log('📊 TESTE 3: Busca por tema\n');

    // MongoDB
    const mongoStart = Date.now();
    const QuestionIndex = await getModel('QuestionIndex', 'telephonic');
    const mongoResults = await QuestionIndex.find({ index: theme }).limit(100);
    const mongoTime = Date.now() - mongoStart;

    console.log(`   MongoDB: ${mongoTime}ms | ${mongoResults.length} perguntas`);

    // BigQuery
    const bqStart = Date.now();
    const query = `
      SELECT 
        question_code,
        question_text,
        survey_number
      FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.question_index\`
      WHERE theme = @theme
      LIMIT 100
    `;

    const [bqResults] = await this.bigquery.query({
      query: query,
      params: { theme }
    });
    const bqTime = Date.now() - bqStart;

    console.log(`   BigQuery: ${bqTime}ms | ${bqResults.length} perguntas`);
    
    const speedup = ((mongoTime / bqTime) * 100 - 100).toFixed(1);
    console.log(`   🚀 BigQuery foi ${Math.abs(speedup)}% ${speedup > 0 ? 'mais rápido' : 'mais lento'}\n`);

    this.results.push({
      test: 'Busca por Tema',
      mongo: mongoTime,
      bigquery: bqTime,
      speedup: speedup
    });
  }

  /**
   * TESTE 4: Análise de série temporal
   */
  async test4_TimeSeriesAnalysis(questionCode) {
    console.log('📊 TESTE 4: Análise de série temporal\n');

    // MongoDB
    const mongoStart = Date.now();
    const Response = await getModel('Response', 'telephonic');
    const mongoResults = await Response.aggregate([
      {
        $match: {
          'answers.k': questionCode
        }
      },
      {
        $group: {
          _id: { year: '$year', rodada: '$rodada' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': -1, '_id.rodada': -1 } }
    ]);
    const mongoTime = Date.now() - mongoStart;

    console.log(`   MongoDB: ${mongoTime}ms | ${mongoResults.length} períodos`);

    // BigQuery
    const bqStart = Date.now();
    const query = `
      SELECT 
        year,
        rodada,
        COUNT(*) as count,
        SUM(weight) as weighted_count
      FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.responses\`
      WHERE question_code = @questionCode
      GROUP BY year, rodada
      ORDER BY year DESC, rodada DESC
    `;

    const [bqResults] = await this.bigquery.query({
      query: query,
      params: { questionCode }
    });
    const bqTime = Date.now() - bqStart;

    console.log(`   BigQuery: ${bqTime}ms | ${bqResults.length} períodos`);
    
    const speedup = ((mongoTime / bqTime) * 100 - 100).toFixed(1);
    console.log(`   🚀 BigQuery foi ${Math.abs(speedup)}% ${speedup > 0 ? 'mais rápido' : 'mais lento'}\n`);

    this.results.push({
      test: 'Série Temporal',
      mongo: mongoTime,
      bigquery: bqTime,
      speedup: speedup
    });
  }

  /**
   * TESTE 5: Contagem total
   */
  async test5_CountQuery(year, rodada) {
    console.log('📊 TESTE 5: Contagem total de respostas\n');

    // MongoDB
    const mongoStart = Date.now();
    const Response = await getModel('Response', 'telephonic');
    const mongoCount = await Response.countDocuments({ year, rodada });
    const mongoTime = Date.now() - mongoStart;

    console.log(`   MongoDB: ${mongoTime}ms | ${mongoCount} documentos`);

    // BigQuery
    const bqStart = Date.now();
    const query = `
      SELECT COUNT(DISTINCT response_id) as total
      FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.responses\`
      WHERE year = @year AND rodada = @rodada
    `;

    const [bqResults] = await this.bigquery.query({
      query: query,
      params: { year, rodada }
    });
    const bqTime = Date.now() - bqStart;
    const bqCount = bqResults[0].total;

    console.log(`   BigQuery: ${bqTime}ms | ${bqCount} respostas únicas`);
    
    const speedup = ((mongoTime / bqTime) * 100 - 100).toFixed(1);
    console.log(`   🚀 BigQuery foi ${Math.abs(speedup)}% ${speedup > 0 ? 'mais rápido' : 'mais lento'}\n`);

    this.results.push({
      test: 'Contagem Total',
      mongo: mongoTime,
      bigquery: bqTime,
      speedup: speedup
    });
  }

  /**
   * Imprime relatório final
   */
  printReport() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 RELATÓRIO FINAL DE PERFORMANCE');
    console.log('='.repeat(80));
    console.log('\n┌────────────────────────────────┬──────────┬──────────┬────────────┐');
    console.log('│ Teste                          │ MongoDB  │ BigQuery │ Diferença  │');
    console.log('├────────────────────────────────┼──────────┼──────────┼────────────┤');

    let totalMongoTime = 0;
    let totalBqTime = 0;

    for (const result of this.results) {
      totalMongoTime += result.mongo;
      totalBqTime += result.bigquery;

      const testName = result.test.padEnd(30);
      const mongoTime = `${result.mongo}ms`.padStart(8);
      const bqTime = `${result.bigquery}ms`.padStart(8);
      const speedup = result.speedup > 0 
        ? `+${result.speedup}%`.padStart(10)
        : `${result.speedup}%`.padStart(10);

      console.log(`│ ${testName} │ ${mongoTime} │ ${bqTime} │ ${speedup} │`);
    }

    console.log('├────────────────────────────────┼──────────┼──────────┼────────────┤');
    const totalSpeedup = ((totalMongoTime / totalBqTime) * 100 - 100).toFixed(1);
    console.log(`│ ${'TOTAL'.padEnd(30)} │ ${`${totalMongoTime}ms`.padStart(8)} │ ${`${totalBqTime}ms`.padStart(8)} │ ${totalSpeedup > 0 ? `+${totalSpeedup}%`.padStart(10) : `${totalSpeedup}%`.padStart(10)} │`);
    console.log('└────────────────────────────────┴──────────┴──────────┴────────────┘\n');

    // Análise
    console.log('📈 ANÁLISE:');
    
    const avgSpeedup = this.results.reduce((sum, r) => sum + parseFloat(r.speedup), 0) / this.results.length;
    
    if (avgSpeedup > 20) {
      console.log('   ✅ BigQuery é significativamente MAIS RÁPIDO (>20%)');
      console.log('   💡 Recomendação: MIGRAR para BigQuery');
    } else if (avgSpeedup > 0) {
      console.log('   ✅ BigQuery é levemente mais rápido');
      console.log('   💡 Recomendação: Considerar migração');
    } else if (avgSpeedup > -20) {
      console.log('   ⚠️  Performance similar');
      console.log('   💡 Recomendação: Avaliar outros fatores (custo, manutenção)');
    } else {
      console.log('   ❌ MongoDB é mais rápido para este volume');
      console.log('   💡 Recomendação: Manter MongoDB ou esperar mais dados');
    }

    console.log('\n💰 ESTIMATIVA DE CUSTOS (mensal):');
    const queriesPerDay = 1000;
    const gbProcessedPerQuery = 0.01; // 10MB por query
    const monthlyGbProcessed = queriesPerDay * 30 * gbProcessedPerQuery;
    const bigQueryCost = (monthlyGbProcessed / 1000) * 5; // $5 por TB
    const storageCost = 0.02 * 1; // $0.02 por GB, assumindo 1GB

    console.log(`   BigQuery (estimado): $${(bigQueryCost + storageCost).toFixed(2)}/mês`);
    console.log(`   MongoDB Atlas M10: $57/mês (fixo)`);
    console.log(`   💡 Economia potencial: $${(57 - bigQueryCost - storageCost).toFixed(2)}/mês\n`);

    console.log('='.repeat(80) + '\n');
  }

  /**
   * Teste de custos estimados
   */
  async estimateCosts() {
    console.log('💰 Estimando custos do BigQuery...\n');

    const query = `
      SELECT 
        COUNT(*) as total_rows,
        COUNT(DISTINCT question_code) as unique_questions
      FROM \`${process.env.GCP_PROJECT_ID}.${this.datasetId}.responses\`
    `;

    const [job] = await this.bigquery.createQueryJob({ query });
    const [rows] = await job.getQueryResults();
    
    // Pegar estatísticas do job
    const [metadata] = await job.getMetadata();
    const bytesProcessed = parseInt(metadata.statistics.totalBytesProcessed);
    const gbProcessed = bytesProcessed / 1024 / 1024 / 1024;
    const cost = (gbProcessed / 1000) * 5; // $5 per TB

    console.log(`   Total de respostas: ${rows[0].total_rows.toLocaleString()}`);
    console.log(`   Perguntas únicas: ${rows[0].unique_questions}`);
    console.log(`   Dados processados: ${gbProcessed.toFixed(3)} GB`);
    console.log(`   Custo desta query: $${cost.toFixed(6)}`);
    console.log(`   Custo de 1000 queries similares: $${(cost * 1000).toFixed(2)}\n`);
  }
}

// ==================== SCRIPT PRINCIPAL ====================

async function main() {
  const args = process.argv.slice(2);
  const questionCode = args[0] || 'P1';
  const theme = args[1] || 'Político';
  const year = parseInt(args[2]) || 2025;
  const rodada = parseInt(args[3]) || 1;

  const test = new PerformanceTest();

  if (args[0] === 'costs') {
    await test.estimateCosts();
  } else {
    await test.runAllTests(questionCode, theme, year, rodada);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n❌ Erro:', error);
      process.exit(1);
    });
}

module.exports = PerformanceTest;