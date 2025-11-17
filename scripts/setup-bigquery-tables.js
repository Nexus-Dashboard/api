// scripts/setup-bigquery-tables.js
require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');

async function setupBigQueryTables() {
  console.log('🔧 Configurando tabelas no BigQuery...\n');

  // Inicializar BigQuery
  const bigquery = new BigQuery({
    projectId: process.env.GCP_PROJECT_ID,
    credentials: {
      client_email: process.env.SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
    }
  });

  const datasetId = process.env.BQ_DATASET_ID || 'survey_data';
  const dataset = bigquery.dataset(datasetId);

  // Verificar se dataset existe
  const [datasetExists] = await dataset.exists();
  if (!datasetExists) {
    console.error(`❌ Dataset '${datasetId}' não encontrado!`);
    console.log('💡 Crie o dataset primeiro no console do BigQuery');
    process.exit(1);
  }

  console.log(`✅ Dataset '${datasetId}' encontrado\n`);

  // ==================== TABELA 1: responses ====================
  console.log('📊 Criando tabela: responses...');
  
  const responsesSchema = [
    { name: 'response_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'survey_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'entrevistado_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'question_code', type: 'STRING', mode: 'REQUIRED' },
    { name: 'answer_value', type: 'STRING', mode: 'NULLABLE' },
    { name: 'year', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'rodada', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'theme', type: 'STRING', mode: 'NULLABLE' },
    { name: 'weight', type: 'FLOAT', mode: 'NULLABLE' },
    
    // Demographics
    { name: 'uf', type: 'STRING', mode: 'NULLABLE' },
    { name: 'regiao', type: 'STRING', mode: 'NULLABLE' },
    { name: 'pf1', type: 'STRING', mode: 'NULLABLE' },
    { name: 'pf2_1', type: 'STRING', mode: 'NULLABLE' },
    { name: 'pf2_faixas', type: 'STRING', mode: 'NULLABLE' },
    { name: 'pf3', type: 'STRING', mode: 'NULLABLE' },
    { name: 'pf4', type: 'STRING', mode: 'NULLABLE' },
    { name: 'pf5', type: 'STRING', mode: 'NULLABLE' },
    { name: 'pf6', type: 'STRING', mode: 'NULLABLE' },
    { name: 'pf7', type: 'STRING', mode: 'NULLABLE' },
    { name: 'pf8', type: 'STRING', mode: 'NULLABLE' },
    { name: 'pf9', type: 'STRING', mode: 'NULLABLE' },
    { name: 'pf10', type: 'STRING', mode: 'NULLABLE' },
    
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
  ];

  const responsesOptions = {
    schema: responsesSchema,
    location: process.env.BQ_LOCATION || 'southamerica-east1',
    timePartitioning: {
      type: 'DAY',
      field: 'created_at',
    },
    clustering: {
      fields: ['question_code', 'year', 'rodada'],
    },
  };

  try {
    const [responsesTable] = await dataset.createTable('responses', responsesOptions);
    console.log('✅ Tabela responses criada com sucesso');
    console.log(`   - Particionada por: created_at (DAY)`);
    console.log(`   - Clusterizada por: question_code, year, rodada`);
  } catch (error) {
    if (error.code === 409) {
      console.log('⚠️  Tabela responses já existe');
    } else {
      console.error('❌ Erro ao criar tabela responses:', error.message);
    }
  }

  console.log('');

  // ==================== TABELA 2: question_index ====================
  console.log('📊 Criando tabela: question_index...');
  
  const questionIndexSchema = [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'survey_number', type: 'STRING', mode: 'REQUIRED' },
    { name: 'survey_name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'question_code', type: 'STRING', mode: 'REQUIRED' },
    { name: 'question_text', type: 'STRING', mode: 'NULLABLE' },
    { name: 'label', type: 'STRING', mode: 'NULLABLE' },
    { name: 'theme', type: 'STRING', mode: 'NULLABLE' },
    { name: 'methodology', type: 'STRING', mode: 'NULLABLE' },
    { name: 'map', type: 'STRING', mode: 'NULLABLE' },
    { name: 'sample', type: 'STRING', mode: 'NULLABLE' },
    { name: 'date', type: 'STRING', mode: 'NULLABLE' },
    { 
      name: 'possible_answers', 
      type: 'RECORD', 
      mode: 'REPEATED',
      fields: [
        { name: 'value', type: 'STRING', mode: 'NULLABLE' },
        { name: 'label', type: 'STRING', mode: 'NULLABLE' },
      ]
    },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
  ];

  const questionIndexOptions = {
    schema: questionIndexSchema,
    location: process.env.BQ_LOCATION || 'southamerica-east1',
    clustering: {
      fields: ['theme', 'question_code'],
    },
  };

  try {
    const [questionIndexTable] = await dataset.createTable('question_index', questionIndexOptions);
    console.log('✅ Tabela question_index criada com sucesso');
    console.log(`   - Clusterizada por: theme, question_code`);
  } catch (error) {
    if (error.code === 409) {
      console.log('⚠️  Tabela question_index já existe');
    } else {
      console.error('❌ Erro ao criar tabela question_index:', error.message);
    }
  }

  console.log('');

  // ==================== TABELA 3: surveys ====================
  console.log('📊 Criando tabela: surveys...');
  
  const surveysSchema = [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'year', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'month', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'file_hashes', type: 'STRING', mode: 'REPEATED' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
  ];

  const surveysOptions = {
    schema: surveysSchema,
    location: process.env.BQ_LOCATION || 'southamerica-east1',
    clustering: {
      fields: ['year', 'month'],
    },
  };

  try {
    const [surveysTable] = await dataset.createTable('surveys', surveysOptions);
    console.log('✅ Tabela surveys criada com sucesso');
    console.log(`   - Clusterizada por: year, month`);
  } catch (error) {
    if (error.code === 409) {
      console.log('⚠️  Tabela surveys já existe');
    } else {
      console.error('❌ Erro ao criar tabela surveys:', error.message);
    }
  }

  console.log('');

  // ==================== VERIFICAÇÃO FINAL ====================
  console.log('🔍 Verificando tabelas criadas...\n');

  const [tables] = await dataset.getTables();
  console.log(`✅ Total de tabelas no dataset: ${tables.length}`);
  tables.forEach(table => {
    console.log(`   - ${table.id}`);
  });

  console.log('\n✅ Setup das tabelas concluído!');
  console.log('\n📝 Próximos passos:');
  console.log('   1. Execute: node scripts/migrate-test-data.js');
  console.log('   2. Para migrar uma rodada de teste\n');
}

// Executar se chamado diretamente
if (require.main === module) {
  setupBigQueryTables()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Erro fatal:', error);
      process.exit(1);
    });
}

module.exports = setupBigQueryTables;