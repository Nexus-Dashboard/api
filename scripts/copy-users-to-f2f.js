// scripts/copy-users-to-f2f.js
// Copia os users do database telephonic para o database f2f

require('dotenv').config();
const mongoose = require('mongoose');
const UserSchema = require('../models/User').schema;

async function copyUsers() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        COPIAR USERS: telephonic → f2f                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  let sourceConn = null;
  let targetConn = null;

  try {
    // URIs
    const sourceUri = 'mongodb+srv://marcossantos:tsvQp2NSFhgr7Cqg@clustermarcos.hld4nnl.mongodb.net/telephonic?retryWrites=true&w=majority&appName=ClusterMarcos';
    const targetUri = 'mongodb+srv://marcossantos:tsvQp2NSFhgr7Cqg@clustermarcos.hld4nnl.mongodb.net/f2f?retryWrites=true&w=majority&appName=ClusterMarcos';

    // Conectar
    console.log('🔌 Conectando aos databases...\n');

    sourceConn = await mongoose.createConnection(sourceUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10
    }).asPromise();
    console.log('   ✅ Conectado ao database ORIGEM (telephonic)\n');

    targetConn = await mongoose.createConnection(targetUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10
    }).asPromise();
    console.log('   ✅ Conectado ao database DESTINO (f2f)\n');

    // Models
    const SourceUser = sourceConn.model('User', UserSchema);
    const TargetUser = targetConn.model('User', UserSchema);

    // Buscar users da origem (incluindo senha)
    console.log('📥 Buscando users do database telephonic...\n');
    const users = await SourceUser.find({}).select('+password').lean();
    console.log(`   ✅ ${users.length} users encontrados\n`);

    if (users.length === 0) {
      console.log('⚠️  Nenhum user encontrado na origem!\n');
      return;
    }

    // Limpar destino
    console.log('🗑️  Limpando users existentes no database f2f...\n');
    const deleteResult = await TargetUser.deleteMany({});
    console.log(`   🗑️  ${deleteResult.deletedCount} users removidos\n`);

    // Copiar users
    console.log('💾 Copiando users para database f2f...\n');

    const cleanUsers = users.map(u => {
      const { _id, ...rest } = u;
      return rest;
    });

    // Usar collection.insertMany para preservar password hash
    await TargetUser.collection.insertMany(cleanUsers, { ordered: false });

    console.log(`   ✅ ${cleanUsers.length} users copiados com sucesso!\n`);

    // Verificar
    const targetCount = await TargetUser.countDocuments();
    console.log('═'.repeat(70));
    console.log('🔍 VERIFICAÇÃO');
    console.log('═'.repeat(70));
    console.log(`   Users no telephonic: ${users.length}`);
    console.log(`   Users no f2f:        ${targetCount}\n`);

    console.log('✅ CÓPIA CONCLUÍDA COM SUCESSO!\n');

  } catch (error) {
    console.error('\n❌ Erro:', error);
    throw error;
  } finally {
    if (sourceConn) await sourceConn.close();
    if (targetConn) await targetConn.close();
    console.log('🔌 Conexões fechadas\n');
  }
}

// Executar
if (require.main === module) {
  copyUsers()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n❌ Erro fatal:', error);
      process.exit(1);
    });
}

module.exports = copyUsers;
