// scripts/test-google-drive-access.js
// Script para testar acesso ao Google Drive e listar arquivos

require('dotenv').config();
const { google } = require('googleapis');

async function testGoogleDriveAccess() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        TESTE DE ACESSO AO GOOGLE DRIVE                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // 1. Inicializar autenticação
    console.log('🔐 Inicializando autenticação Google...\n');

    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: process.env.TYPE,
        project_id: process.env.PROJECT_ID,
        private_key_id: process.env.PRIVATE_KEY_ID,
        private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.SERVICE_ACCOUNT_EMAIL,
        client_id: process.env.CLIENT_ID,
        auth_uri: process.env.AUTH_URI,
        token_uri: process.env.TOKEN_URI,
        auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_X509_CERT_URL,
        client_x509_cert_url: process.env.CLIENT_X509_CERT_URL,
      },
      scopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/spreadsheets.readonly'
      ],
    });

    const authClient = await auth.getClient();
    const drive = google.drive({ version: 'v3', auth: authClient });

    console.log('✅ Autenticação bem-sucedida!\n');
    console.log(`📧 Service Account: ${process.env.SERVICE_ACCOUNT_EMAIL}\n`);

    // 2. Testar acesso às pastas
    const folders = {
      telephonic: '19ECwWCTZX2kvuyOnGT-FMP4BoysmuH8Y',
      telephonic_index: '1QQsygOl1soLzXOHnovyTP290iLHmRoDE9mdaA2Zz0ek',
      f2f: '1uwkW5wF7Cm0uVmRirhQc5eQ2Dl6c3qVL',
      f2f_index: '1rYFKyVVCOCn_Y6pAXS1AnOZU7F2wzSEAlg-9Oqsr0tk'
    };

    for (const [name, folderId] of Object.entries(folders)) {
      console.log('═'.repeat(70));
      console.log(`📂 Testando: ${name.toUpperCase()}`);
      console.log(`   ID: ${folderId}`);
      console.log('═'.repeat(70) + '\n');

      try {
        // Buscar arquivos Google Sheets na pasta
        const response = await drive.files.list({
          q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
          fields: 'files(id, name, modifiedTime, owners, permissions)',
          orderBy: 'name',
          pageSize: 100
        });

        const files = response.data.files;

        if (files.length === 0) {
          console.log('   ⚠️  Nenhum arquivo Google Sheets encontrado!\n');
          console.log('   Possíveis causas:');
          console.log('   1. A pasta está vazia');
          console.log('   2. Os arquivos não são Google Sheets');
          console.log('   3. A Service Account não tem permissão de leitura\n');

          // Tentar obter informações da pasta
          try {
            const folderInfo = await drive.files.get({
              fileId: folderId,
              fields: 'id, name, mimeType, owners, shared'
            });

            console.log('   ℹ️  Informações da pasta:');
            console.log(`      Nome: ${folderInfo.data.name}`);
            console.log(`      Tipo: ${folderInfo.data.mimeType}`);
            console.log(`      Compartilhado: ${folderInfo.data.shared ? 'Sim' : 'Não'}\n`);
          } catch (error) {
            console.log('   ❌ Não foi possível acessar a pasta');
            console.log(`   Erro: ${error.message}\n`);
          }
        } else {
          console.log(`   ✅ Encontrados ${files.length} arquivos Google Sheets:\n`);

          files.forEach((file, index) => {
            const modifiedDate = new Date(file.modifiedTime).toLocaleDateString('pt-BR');
            console.log(`   ${index + 1}. ${file.name}`);
            console.log(`      ID: ${file.id}`);
            console.log(`      Modificado: ${modifiedDate}`);

            // Tentar extrair rodada
            const rodadaMatch = file.name.match(/rodada\s*(\d+)/i);
            if (rodadaMatch) {
              console.log(`      Rodada: ${rodadaMatch[1]}`);
            } else {
              console.log(`      Rodada: ⚠️ não encontrada`);
            }

            // Tentar extrair ano
            const yearMatch = file.name.match(/20(\d{2})/);
            if (yearMatch) {
              console.log(`      Ano: ${yearMatch[0]}`);
            } else {
              console.log(`      Ano: ⚠️ não encontrado`);
            }

            console.log('');
          });
        }

      } catch (error) {
        console.log(`   ❌ Erro ao acessar pasta: ${error.message}\n`);

        if (error.code === 404) {
          console.log('   📝 Pasta não encontrada. Verifique o ID da pasta.\n');
        } else if (error.code === 403) {
          console.log('   📝 Sem permissão de acesso.');
          console.log('   Verifique se a pasta foi compartilhada com a Service Account:\n');
          console.log(`   ${process.env.SERVICE_ACCOUNT_EMAIL}\n`);
        }
      }
    }

    console.log('═'.repeat(70));
    console.log('✅ TESTE CONCLUÍDO!');
    console.log('═'.repeat(70) + '\n');

  } catch (error) {
    console.error('\n❌ Erro fatal:', error);
    console.error('\n📋 Stack trace:', error.stack);
    process.exit(1);
  }
}

// Executar
testGoogleDriveAccess()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ Erro:', error);
    process.exit(1);
  });
