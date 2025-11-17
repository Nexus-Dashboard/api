// scripts/migrate-cluster-telephonic.js
// Migra dados do cluster antigo (Cluster0) para o novo (ClusterMarcos)

require('dotenv').config();
const mongoose = require('mongoose');

// Schemas
const QuestionIndexSchema = require('../models/QuestionIndex').schema;
const SurveySchema = require('../models/Survey').schema;
const ResponseSchema = require('../models/Response').schema;
const UserSchema = require('../models/User').schema;

class ClusterMigration {
  constructor() {
    this.sourceConn = null;
    this.targetConn = null;

    // URI do cluster ANTIGO (sem espaço)
    this.sourceUri = 'mongodb+srv://admin:AHj4XyQ5oxO6gzLY@cluster0.4svobfi.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

    // URI do cluster NOVO (com espaço) - database 'telephonic'
    this.targetUri = 'mongodb+srv://marcossantos:tsvQp2NSFhgr7Cqg@clustermarcos.hld4nnl.mongodb.net/telephonic?retryWrites=true&w=majority&appName=ClusterMarcos';

    this.stats = {
      questionIndex: { source: 0, migrated: 0 },
      surveys: { source: 0, migrated: 0 },
      responses: { source: 0, migrated: 0 },
      users: { source: 0, migrated: 0 },
      errors: [],
      startTime: null,
      endTime: null
    };
  }

  async connect() {
    console.log('🔌 Conectando aos clusters...\n');

    try {
      // Conectar ao cluster ORIGEM (antigo)
      console.log('   📍 Conectando ao cluster ORIGEM (Cluster0)...');
      this.sourceConn = await mongoose.createConnection(this.sourceUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10
      }).asPromise();
      console.log('   ✅ Conectado ao cluster ORIGEM\n');

      // Conectar ao cluster DESTINO (novo)
      console.log('   📍 Conectando ao cluster DESTINO (ClusterMarcos/telephonic)...');
      this.targetConn = await mongoose.createConnection(this.targetUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10
      }).asPromise();
      console.log('   ✅ Conectado ao cluster DESTINO\n');

    } catch (error) {
      console.error('❌ Erro ao conectar aos clusters:', error);
      throw error;
    }
  }

  async migrateQuestionIndex() {
    console.log('═'.repeat(70));
    console.log('📋 MIGRANDO QUESTION INDEX');
    console.log('═'.repeat(70) + '\n');

    try {
      const SourceModel = this.sourceConn.model('QuestionIndex', QuestionIndexSchema);
      const TargetModel = this.targetConn.model('QuestionIndex', QuestionIndexSchema);

      // Contar registros na origem
      this.stats.questionIndex.source = await SourceModel.countDocuments();
      console.log(`   📊 Total na origem: ${this.stats.questionIndex.source.toLocaleString()}\n`);

      if (this.stats.questionIndex.source === 0) {
        console.log('   ⚠️  Nenhum registro encontrado na origem!\n');
        return;
      }

      // Buscar todos os registros
      console.log('   📥 Buscando registros da origem...');
      const records = await SourceModel.find({}).lean();
      console.log(`   ✅ ${records.length.toLocaleString()} registros carregados\n`);

      // Limpar destino (opcional)
      console.log('   🗑️  Limpando destino...');
      const deleteResult = await TargetModel.deleteMany({});
      console.log(`   🗑️  ${deleteResult.deletedCount.toLocaleString()} registros removidos do destino\n`);

      // Inserir em lotes
      const BATCH_SIZE = 500;
      let inserted = 0;

      console.log('   💾 Inserindo no destino...\n');

      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);

        // Remover _id para evitar conflitos
        const cleanBatch = batch.map(r => {
          const { _id, ...rest } = r;
          return rest;
        });

        try {
          await TargetModel.insertMany(cleanBatch, { ordered: false });
          inserted += cleanBatch.length;
          console.log(`   ✅ ${inserted.toLocaleString()}/${records.length.toLocaleString()} registros migrados`);
        } catch (error) {
          if (error.writeErrors) {
            inserted += cleanBatch.length - error.writeErrors.length;
            console.log(`   ⚠️  ${error.writeErrors.length} duplicatas ignoradas`);
          } else {
            throw error;
          }
        }
      }

      this.stats.questionIndex.migrated = inserted;
      console.log(`\n✅ QuestionIndex migrado: ${inserted.toLocaleString()} registros\n`);

    } catch (error) {
      console.error('❌ Erro ao migrar QuestionIndex:', error);
      this.stats.errors.push({ collection: 'QuestionIndex', error: error.message });
      throw error;
    }
  }

  async migrateSurveys() {
    console.log('═'.repeat(70));
    console.log('📊 MIGRANDO SURVEYS');
    console.log('═'.repeat(70) + '\n');

    try {
      const SourceModel = this.sourceConn.model('Survey', SurveySchema);
      const TargetModel = this.targetConn.model('Survey', SurveySchema);

      // Contar registros na origem
      this.stats.surveys.source = await SourceModel.countDocuments();
      console.log(`   📊 Total na origem: ${this.stats.surveys.source.toLocaleString()}\n`);

      if (this.stats.surveys.source === 0) {
        console.log('   ⚠️  Nenhum registro encontrado na origem!\n');
        return;
      }

      // Buscar todos os registros
      console.log('   📥 Buscando registros da origem...');
      const records = await SourceModel.find({}).lean();
      console.log(`   ✅ ${records.length.toLocaleString()} registros carregados\n`);

      // Limpar destino
      console.log('   🗑️  Limpando destino...');
      const deleteResult = await TargetModel.deleteMany({});
      console.log(`   🗑️  ${deleteResult.deletedCount.toLocaleString()} registros removidos do destino\n`);

      // Inserir em lotes
      const BATCH_SIZE = 100;
      let inserted = 0;

      console.log('   💾 Inserindo no destino...\n');

      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);

        const cleanBatch = batch.map(r => {
          const { _id, ...rest } = r;
          return rest;
        });

        try {
          await TargetModel.insertMany(cleanBatch, { ordered: false });
          inserted += cleanBatch.length;
          console.log(`   ✅ ${inserted.toLocaleString()}/${records.length.toLocaleString()} registros migrados`);
        } catch (error) {
          if (error.writeErrors) {
            inserted += cleanBatch.length - error.writeErrors.length;
            console.log(`   ⚠️  ${error.writeErrors.length} duplicatas ignoradas`);
          } else {
            throw error;
          }
        }
      }

      this.stats.surveys.migrated = inserted;
      console.log(`\n✅ Surveys migrados: ${inserted.toLocaleString()} registros\n`);

    } catch (error) {
      console.error('❌ Erro ao migrar Surveys:', error);
      this.stats.errors.push({ collection: 'Surveys', error: error.message });
      throw error;
    }
  }

  async migrateResponses() {
    console.log('═'.repeat(70));
    console.log('💬 MIGRANDO RESPONSES');
    console.log('═'.repeat(70) + '\n');

    try {
      const SourceModel = this.sourceConn.model('Response', ResponseSchema);
      const TargetModel = this.targetConn.model('Response', ResponseSchema);

      // Contar registros na origem
      this.stats.responses.source = await SourceModel.countDocuments();
      console.log(`   📊 Total na origem: ${this.stats.responses.source.toLocaleString()}\n`);

      if (this.stats.responses.source === 0) {
        console.log('   ⚠️  Nenhum registro encontrado na origem!\n');
        return;
      }

      console.log('   ⚠️  AVISO: Esta é a maior coleção e pode demorar!\n');

      // Limpar destino
      console.log('   🗑️  Limpando destino...');
      const deleteResult = await TargetModel.deleteMany({});
      console.log(`   🗑️  ${deleteResult.deletedCount.toLocaleString()} registros removidos do destino\n`);

      // Migrar usando cursor (streaming) para economizar memória
      const BATCH_SIZE = 1000;
      let inserted = 0;
      let batch = [];

      console.log('   💾 Iniciando migração em streaming...\n');

      const cursor = SourceModel.find({}).lean().cursor();

      for await (const doc of cursor) {
        const { _id, ...rest } = doc;
        batch.push(rest);

        if (batch.length >= BATCH_SIZE) {
          try {
            await TargetModel.insertMany(batch, { ordered: false });
            inserted += batch.length;
            const progress = ((inserted / this.stats.responses.source) * 100).toFixed(1);
            console.log(`   📈 ${progress}% | ${inserted.toLocaleString()}/${this.stats.responses.source.toLocaleString()} registros migrados`);
            batch = [];
          } catch (error) {
            if (error.writeErrors) {
              inserted += batch.length - error.writeErrors.length;
              console.log(`   ⚠️  ${error.writeErrors.length} duplicatas ignoradas`);
              batch = [];
            } else {
              throw error;
            }
          }
        }
      }

      // Inserir últimos registros
      if (batch.length > 0) {
        try {
          await TargetModel.insertMany(batch, { ordered: false });
          inserted += batch.length;
        } catch (error) {
          if (error.writeErrors) {
            inserted += batch.length - error.writeErrors.length;
            console.log(`   ⚠️  ${error.writeErrors.length} duplicatas ignoradas`);
          } else {
            throw error;
          }
        }
      }

      this.stats.responses.migrated = inserted;
      console.log(`\n✅ Responses migrados: ${inserted.toLocaleString()} registros\n`);

    } catch (error) {
      console.error('❌ Erro ao migrar Responses:', error);
      this.stats.errors.push({ collection: 'Responses', error: error.message });
      throw error;
    }
  }

  async migrateUsers() {
    console.log('═'.repeat(70));
    console.log('👥 MIGRANDO USERS');
    console.log('═'.repeat(70) + '\n');

    try {
      const SourceModel = this.sourceConn.model('User', UserSchema);
      const TargetModel = this.targetConn.model('User', UserSchema);

      // Contar registros na origem
      this.stats.users.source = await SourceModel.countDocuments();
      console.log(`   📊 Total na origem: ${this.stats.users.source.toLocaleString()}\n`);

      if (this.stats.users.source === 0) {
        console.log('   ⚠️  Nenhum registro encontrado na origem!\n');
        return;
      }

      // Buscar todos os registros (incluindo senha, pois select: false)
      console.log('   📥 Buscando registros da origem...');
      const records = await SourceModel.find({}).select('+password').lean();
      console.log(`   ✅ ${records.length.toLocaleString()} registros carregados\n`);

      // Limpar destino
      console.log('   🗑️  Limpando destino...');
      const deleteResult = await TargetModel.deleteMany({});
      console.log(`   🗑️  ${deleteResult.deletedCount.toLocaleString()} registros removidos do destino\n`);

      // Inserir em lotes
      const BATCH_SIZE = 50;
      let inserted = 0;

      console.log('   💾 Inserindo no destino...\n');

      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);

        // Remover _id para evitar conflitos, mas manter password hash
        const cleanBatch = batch.map(r => {
          const { _id, ...rest } = r;
          return rest;
        });

        try {
          // IMPORTANTE: Usar insertMany com validação desabilitada para não rehash a senha
          await TargetModel.collection.insertMany(cleanBatch, { ordered: false });
          inserted += cleanBatch.length;
          console.log(`   ✅ ${inserted.toLocaleString()}/${records.length.toLocaleString()} registros migrados`);
        } catch (error) {
          if (error.writeErrors) {
            inserted += cleanBatch.length - error.writeErrors.length;
            console.log(`   ⚠️  ${error.writeErrors.length} duplicatas ignoradas`);
          } else {
            throw error;
          }
        }
      }

      this.stats.users.migrated = inserted;
      console.log(`\n✅ Users migrados: ${inserted.toLocaleString()} registros\n`);

    } catch (error) {
      console.error('❌ Erro ao migrar Users:', error);
      this.stats.errors.push({ collection: 'Users', error: error.message });
      throw error;
    }
  }

  async verifyMigration() {
    console.log('═'.repeat(70));
    console.log('🔍 VERIFICANDO MIGRAÇÃO');
    console.log('═'.repeat(70) + '\n');

    const TargetQuestionIndex = this.targetConn.model('QuestionIndex', QuestionIndexSchema);
    const TargetSurvey = this.targetConn.model('Survey', SurveySchema);
    const TargetResponse = this.targetConn.model('Response', ResponseSchema);
    const TargetUser = this.targetConn.model('User', UserSchema);

    const qiCount = await TargetQuestionIndex.countDocuments();
    const surveyCount = await TargetSurvey.countDocuments();
    const responseCount = await TargetResponse.countDocuments();
    const userCount = await TargetUser.countDocuments();

    console.log('   📊 Registros no DESTINO:');
    console.log(`      QuestionIndex: ${qiCount.toLocaleString()}`);
    console.log(`      Surveys:       ${surveyCount.toLocaleString()}`);
    console.log(`      Responses:     ${responseCount.toLocaleString()}`);
    console.log(`      Users:         ${userCount.toLocaleString()}\n`);

    console.log('   ✅ Migração verificada!\n');
  }

  async migrate() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     MIGRAÇÃO DE CLUSTER: Cluster0 → ClusterMarcos        ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    this.stats.startTime = Date.now();

    try {
      // 1. Conectar
      await this.connect();

      // 2. Migrar Users (primeiro para ter usuários no destino)
      await this.migrateUsers();

      // 3. Migrar QuestionIndex
      await this.migrateQuestionIndex();

      // 4. Migrar Surveys
      await this.migrateSurveys();

      // 5. Migrar Responses
      await this.migrateResponses();

      // 6. Verificar
      await this.verifyMigration();

      // 6. Relatório final
      this.stats.endTime = Date.now();
      this.printReport();

    } catch (error) {
      console.error('\n❌ Erro fatal durante migração:', error);
      throw error;
    } finally {
      // Fechar conexões
      if (this.sourceConn) {
        await this.sourceConn.close();
        console.log('   🔌 Conexão ORIGEM fechada');
      }
      if (this.targetConn) {
        await this.targetConn.close();
        console.log('   🔌 Conexão DESTINO fechada\n');
      }
    }
  }

  printReport() {
    const duration = ((this.stats.endTime - this.stats.startTime) / 1000 / 60).toFixed(2);

    console.log('\n' + '═'.repeat(70));
    console.log('📊 RELATÓRIO FINAL DE MIGRAÇÃO');
    console.log('═'.repeat(70));
    console.log(`⏱️  Duração: ${duration} minutos\n`);

    console.log('📈 ESTATÍSTICAS:');
    console.log(`   Users:         ${this.stats.users.source.toLocaleString()} → ${this.stats.users.migrated.toLocaleString()}`);
    console.log(`   QuestionIndex: ${this.stats.questionIndex.source.toLocaleString()} → ${this.stats.questionIndex.migrated.toLocaleString()}`);
    console.log(`   Surveys:       ${this.stats.surveys.source.toLocaleString()} → ${this.stats.surveys.migrated.toLocaleString()}`);
    console.log(`   Responses:     ${this.stats.responses.source.toLocaleString()} → ${this.stats.responses.migrated.toLocaleString()}\n`);

    if (this.stats.errors.length > 0) {
      console.log('❌ ERROS:');
      this.stats.errors.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.collection}: ${err.error}`);
      });
      console.log('');
    }

    console.log('═'.repeat(70));
    console.log('✅ MIGRAÇÃO CONCLUÍDA COM SUCESSO!');
    console.log('═'.repeat(70) + '\n');

    console.log('📝 Próximos passos:');
    console.log('   1. Verifique os dados no MongoDB Compass');
    console.log('   2. Teste a aplicação com o novo cluster');
    console.log('   3. Se tudo estiver OK, pode desativar o cluster antigo\n');
  }
}

// Executar
async function main() {
  const migration = new ClusterMigration();
  await migration.migrate();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n❌ Erro fatal:', error);
      console.error('\n📋 Stack trace:', error.stack);
      process.exit(1);
    });
}

module.exports = ClusterMigration;
