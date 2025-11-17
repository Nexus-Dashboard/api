// scripts/migrate-from-google-sheets.js
require('dotenv').config();
const { getModel } = require('../config/dbManager');
const { google } = require('googleapis');

class GoogleSheetsMigration {
  constructor(options = {}) {
    this.auth = null;
    this.sheets = null;
    this.drive = null;

    // Configuração de qual tipo de migração executar
    this.migrationType = options.type || 'telephonic'; // 'telephonic' ou 'f2f'
    this.dbKey = this.migrationType === 'f2f' ? 'f2f' : 'telephonic';

    // IDs das pastas e índices
    this.folders = {
      telephonic: {
        main: '1b4zuiPji7j6SB2dSZacAXUsfp96zD_Go',
        index: '1h27lqHA9TD0IqM6A9M5JE8KyB7LySUt08dvBdCdyx0o'
      },
      f2f: {
        main: '1CooU5x5fAUfDPBrX0UzvlnBVqKufWQ4q',
        index: '1zLfFCm3FppNIV9kPKIvkR7HO1OKWGdC3ZTnw11XutOc'
      }
    };

    this.dryRun = options.dryRun || false;
    this.stats = {
      processedFiles: 0,
      totalFiles: 0,
      surveys: 0,
      responses: 0,
      questionIndex: 0,
      errors: [],
      startTime: null,
      endTime: null
    };
  }

  async initialize() {
    try {
      console.log('🔐 Inicializando autenticação Google...\n');

      this.auth = new google.auth.GoogleAuth({
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
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/spreadsheets'
        ],
      });

      const authClient = await this.auth.getClient();
      this.drive = google.drive({ version: 'v3', auth: authClient });
      this.sheets = google.sheets({ version: 'v4', auth: authClient });

      console.log('✅ Google APIs inicializadas com sucesso!\n');
    } catch (error) {
      console.error('❌ Erro ao inicializar Google APIs:', error);
      throw error;
    }
  }

  /**
   * Lista todos os arquivos Google Sheets em uma pasta
   */
  async listSheetsInFolder(folderId) {
    try {
      console.log(`📂 Listando arquivos na pasta ${folderId}...\n`);

      const response = await this.drive.files.list({
        q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
        fields: 'files(id, name, modifiedTime)',
        orderBy: 'name',
      });

      const files = response.data.files;
      console.log(`   ✅ Encontrados ${files.length} arquivos Google Sheets\n`);

      // Listar os nomes dos arquivos encontrados
      if (files.length > 0) {
        console.log(`   📄 Arquivos encontrados:`);
        files.forEach((file, index) => {
          console.log(`      ${index + 1}. ${file.name}`);
        });
        console.log('');
      } else {
        console.log(`   ⚠️  Nenhum arquivo Google Sheets encontrado na pasta!`);
        console.log(`   ℹ️  Verifique:`);
        console.log(`      - Se o ID da pasta está correto: ${folderId}`);
        console.log(`      - Se a Service Account tem permissão de leitura na pasta`);
        console.log(`      - Se existem arquivos Google Sheets na pasta\n`);
      }

      return files;
    } catch (error) {
      console.error('❌ Erro ao listar arquivos:', error);
      if (error.message.includes('404')) {
        console.error('   ℹ️  Pasta não encontrada. Verifique o ID da pasta.');
      } else if (error.message.includes('403')) {
        console.error('   ℹ️  Sem permissão. Verifique se a Service Account tem acesso à pasta.');
      }
      throw error;
    }
  }

  /**
   * Lê dados de um arquivo Google Sheets
   */
  async readGoogleSheet(fileId, sheetName = null) {
    try {
      // Se não especificar aba, lê a primeira
      const range = sheetName || 'A1:ZZ';

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: fileId,
        range: range,
        valueRenderOption: 'FORMATTED_VALUE',
      });

      return response.data.values || [];
    } catch (error) {
      console.error(`❌ Erro ao ler planilha ${fileId}:`, error.message);
      throw error;
    }
  }

  /**
   * Lê o arquivo de índice de perguntas
   */
  async migrateQuestionIndex() {
    console.log('═'.repeat(70));
    console.log(`📋 MIGRANDO ÍNDICE DE PERGUNTAS [${this.migrationType.toUpperCase()}]`);
    console.log('═'.repeat(70) + '\n');

    try {
      const indexId = this.folders[this.migrationType].index;
      console.log(`📖 Lendo arquivo de índice: ${indexId}\n`);

      // Ler dados do índice
      const rows = await this.readGoogleSheet(indexId);

      if (rows.length === 0) {
        console.log('⚠️  Arquivo de índice vazio!\n');
        return;
      }

      // Primeira linha é o cabeçalho
      const headers = rows[0];
      console.log(`   📊 Cabeçalhos encontrados: ${headers.join(', ')}\n`);
      console.log(`   📝 Total de linhas: ${rows.length - 1}\n`);

      const QuestionIndex = await getModel('QuestionIndex', this.dbKey);

      // Processar cada linha (pular cabeçalho)
      const questions = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];

        // Mapear colunas para campos do modelo
        // Ajuste os índices conforme a estrutura real do seu índice
        const question = {
          surveyNumber: row[0] || '',
          surveyName: row[1] || '',
          variable: row[2] || '',
          questionText: row[3] || '',
          label: row[4] || '',
          index: row[5] || '', // theme
          methodology: row[6] || '',
          map: row[7] || '',
          sample: row[8] || '',
          date: row[9] || '',
          possibleAnswers: this.parsePossibleAnswers(row[10] || ''),
        };

        questions.push(question);
      }

      if (this.dryRun) {
        console.log(`   [DRY-RUN] Seria inserido: ${questions.length} perguntas\n`);
        this.stats.questionIndex = questions.length;
        return;
      }

      // Limpar índice existente antes de inserir novos dados
      console.log('   🗑️  Limpando índice existente...\n');
      const deleteResult = await QuestionIndex.deleteMany({});
      console.log(`   🗑️  ${deleteResult.deletedCount} perguntas removidas\n`);

      // Usar bulkWrite com upsert para evitar duplicatas
      console.log('   💾 Inserindo perguntas...\n');

      const BATCH_SIZE = 100;
      let insertedCount = 0;

      for (let i = 0; i < questions.length; i += BATCH_SIZE) {
        const batch = questions.slice(i, i + BATCH_SIZE);

        // Usar bulkWrite com upsert
        const operations = batch.map(q => ({
          updateOne: {
            filter: {
              surveyNumber: q.surveyNumber,
              variable: q.variable
            },
            update: { $set: q },
            upsert: true
          }
        }));

        try {
          const result = await QuestionIndex.bulkWrite(operations, { ordered: false });
          insertedCount += result.upsertedCount + result.modifiedCount;
          console.log(`   ✅ Processadas ${Math.min(i + BATCH_SIZE, questions.length)}/${questions.length} perguntas`);
        } catch (error) {
          console.error(`   ⚠️  Erro em lote ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message);
          // Continuar mesmo com erro
        }
      }

      this.stats.questionIndex = insertedCount;
      console.log(`\n✅ ${insertedCount} perguntas migradas/atualizadas com sucesso!\n`);

    } catch (error) {
      console.error('❌ Erro ao migrar índice de perguntas:', error);
      this.stats.errors.push({
        type: 'question_index',
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Parseia respostas possíveis de uma string
   */
  parsePossibleAnswers(text) {
    if (!text || text.trim() === '') return [];

    // Se for JSON, tentar parsear
    try {
      if (text.startsWith('[') || text.startsWith('{')) {
        return JSON.parse(text);
      }
    } catch (e) {
      // Não é JSON, continuar
    }

    // Se for formato "1: Sim, 2: Não", parsear
    const answers = [];
    const lines = text.split(/[,;]/).map(l => l.trim());

    for (const line of lines) {
      const match = line.match(/^(\d+):\s*(.+)$/);
      if (match) {
        answers.push({
          value: match[1],
          label: match[2]
        });
      }
    }

    return answers;
  }

  /**
   * Migra dados das pesquisas (surveys e responses)
   */
  async migrateSurveyData() {
    console.log('═'.repeat(70));
    console.log(`📊 MIGRANDO DADOS DAS PESQUISAS [${this.migrationType.toUpperCase()}]`);
    console.log('═'.repeat(70) + '\n');

    try {
      const folderId = this.folders[this.migrationType].main;
      const files = await this.listSheetsInFolder(folderId);

      this.stats.totalFiles = files.length;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`\n${'─'.repeat(70)}`);
        console.log(`📄 Arquivo ${i + 1}/${files.length}: ${file.name}`);
        console.log(`${'─'.repeat(70)}\n`);

        try {
          await this.processSurveyFile(file);
          this.stats.processedFiles++;
        } catch (error) {
          console.error(`❌ Erro ao processar arquivo ${file.name}:`, error.message);
          this.stats.errors.push({
            file: file.name,
            error: error.message
          });
        }
      }

    } catch (error) {
      console.error('❌ Erro ao migrar dados de pesquisas:', error);
      throw error;
    }
  }

  /**
   * Processa um arquivo de pesquisa individual
   */
  async processSurveyFile(file) {
    try {
      console.log(`   📖 Lendo arquivo ${file.id}...\n`);

      // Extrair ano e rodada do nome do arquivo
      const { year, rodada } = this.extractYearAndRodada(file.name);

      if (!rodada) {
        console.log(`   ❌ ERRO: Não foi possível extrair a rodada do nome do arquivo!\n`);
        console.log(`   ℹ️  O nome do arquivo deve conter "RODADA XX" ou "Rodada XX"\n`);
        console.log(`   ⏭️  Pulando arquivo...\n`);
        this.stats.errors.push({
          file: file.name,
          error: 'Rodada não encontrada no nome do arquivo'
        });
        return;
      }

      if (!year) {
        console.log(`   ⚠️  AVISO: Ano não encontrado no nome, usando ano atual (${new Date().getFullYear()})\n`);
      }

      console.log(`   ✅ Ano: ${year}, Rodada: ${rodada}\n`);

      // Ler dados do arquivo
      const rows = await this.readGoogleSheet(file.id);

      if (rows.length === 0) {
        console.log('   ⚠️  Arquivo vazio!\n');
        return;
      }

      console.log(`   📝 Total de linhas: ${rows.length}\n`);

      // Primeira linha é o cabeçalho (variáveis)
      const headers = rows[0];
      console.log(`   📊 Variáveis encontradas: ${headers.length}\n`);

      // Criar ou atualizar Survey
      const Survey = await getModel('Survey', this.dbKey);

      let survey;

      if (this.dryRun) {
        console.log(`   [DRY-RUN] Criaria/atualizaria survey: ${year}-R${rodada}\n`);
        survey = { _id: 'dry-run-id' };
      } else {
        // Usar findOneAndUpdate com upsert para evitar duplicatas
        try {
          survey = await Survey.findOneAndUpdate(
            { year, month: rodada },
            {
              $set: {
                name: file.name,
                year,
                month: rodada
              },
              $addToSet: { fileHashes: file.id }
            },
            {
              upsert: true,
              new: true,
              setDefaultsOnInsert: true
            }
          );

          const isNew = survey.fileHashes && survey.fileHashes.length === 1;
          const action = isNew ? 'criada' : 'atualizada';

          console.log(`   ✅ Survey ${action}: ${survey._id}\n`);

          if (isNew) {
            this.stats.surveys++;
          }
        } catch (error) {
          // Se falhar por nome duplicado, buscar pela combinação year/month
          if (error.code === 11000) {
            console.log(`   ⚠️  Nome duplicado detectado, buscando por year/month...\n`);
            survey = await Survey.findOne({ year, month: rodada });
            if (!survey) {
              throw error; // Se ainda não encontrar, relançar erro
            }
            console.log(`   ℹ️  Survey encontrada: ${survey._id}\n`);
          } else {
            throw error;
          }
        }
      }

      // Processar respostas (cada linha é um entrevistado)
      const Response = await getModel('Response', this.dbKey);

      // Limpar respostas antigas desta survey antes de inserir novas
      if (!this.dryRun) {
        console.log(`   🗑️  Limpando respostas antigas desta survey...\n`);
        const deleteResult = await Response.deleteMany({
          surveyId: survey._id,
          year,
          rodada
        });
        console.log(`   🗑️  ${deleteResult.deletedCount} respostas antigas removidas\n`);
      }

      let insertedCount = 0;
      let errorCount = 0;
      const BATCH_SIZE = 100;
      const responses = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];

        // Cada linha representa um entrevistado
        const answers = [];
        for (let j = 0; j < headers.length; j++) {
          if (row[j] !== undefined && row[j] !== null && row[j] !== '') {
            answers.push({
              k: headers[j], // nome da variável
              v: row[j]       // valor da resposta
            });
          }
        }

        if (answers.length === 0) continue;

        // Tentar extrair ID do entrevistado (assumindo que está em alguma coluna específica)
        const entrevistadoId = this.extractEntrevistadoId(headers, row) || `${year}_${rodada}_${i}`;

        const response = {
          surveyId: this.dryRun ? 'dry-run-id' : survey._id,
          entrevistadoId,
          year,
          rodada,
          answers
        };

        responses.push(response);

        // Inserir em lotes
        if (responses.length >= BATCH_SIZE) {
          if (!this.dryRun) {
            try {
              await Response.insertMany(responses, { ordered: false });
              insertedCount += responses.length;
            } catch (error) {
              // Se houver erro de duplicata, contar apenas os inseridos
              if (error.writeErrors) {
                const inserted = responses.length - error.writeErrors.length;
                insertedCount += inserted;
                errorCount += error.writeErrors.length;
                console.log(`   ⚠️  ${error.writeErrors.length} duplicatas ignoradas`);
              } else {
                throw error;
              }
            }
          } else {
            insertedCount += responses.length;
          }
          console.log(`   📈 Progresso: ${insertedCount}/${rows.length - 1} respostas processadas`);
          responses.length = 0; // Limpar array
        }
      }

      // Inserir respostas restantes
      if (responses.length > 0) {
        if (!this.dryRun) {
          try {
            await Response.insertMany(responses, { ordered: false });
            insertedCount += responses.length;
          } catch (error) {
            if (error.writeErrors) {
              const inserted = responses.length - error.writeErrors.length;
              insertedCount += inserted;
              errorCount += error.writeErrors.length;
              console.log(`   ⚠️  ${error.writeErrors.length} duplicatas ignoradas`);
            } else {
              throw error;
            }
          }
        } else {
          insertedCount += responses.length;
        }
      }

      this.stats.responses += insertedCount;

      if (this.dryRun) {
        console.log(`\n   [DRY-RUN] Seria inserido: ${insertedCount} respostas\n`);
      } else {
        const successMsg = errorCount > 0
          ? `${insertedCount} respostas inseridas (${errorCount} duplicatas ignoradas)`
          : `${insertedCount} respostas inseridas com sucesso`;
        console.log(`\n   ✅ ${successMsg}!\n`);
      }

    } catch (error) {
      console.error('   ❌ Erro ao processar arquivo:', error);
      throw error;
    }
  }

  /**
   * Extrai ano e rodada do nome do arquivo
   */
  extractYearAndRodada(fileName) {
    // Padrões comuns:
    // "BD - TRACKING - RODADA 44 - 2025 (Google Sheets)"
    // "2024 - Rodada 35 (Google Sheets)"
    // "BD SECOM - AGOSTO - RODADA 45 (Google Sheets)"

    console.log(`   🔍 Analisando nome do arquivo: "${fileName}"`);

    let year = null;
    let rodada = null;

    // Extrair ano (formato 20XX)
    const yearMatch = fileName.match(/20(\d{2})/);
    if (yearMatch) {
      year = parseInt(yearMatch[0]);
      console.log(`   📅 Ano encontrado: ${year}`);
    } else {
      // Se não encontrar ano no nome, usar ano atual
      year = new Date().getFullYear();
      console.log(`   ⚠️  Ano não encontrado no nome, usando ano atual: ${year}`);
    }

    // Extrair rodada
    const rodadaMatch = fileName.match(/rodada\s*(\d+)/i);
    if (rodadaMatch) {
      rodada = parseInt(rodadaMatch[1]);
      console.log(`   🔢 Rodada encontrada: ${rodada}`);
    } else {
      console.log(`   ⚠️  Rodada não encontrada no nome do arquivo`);
    }

    // Tentar extrair mês do nome (para usar como rodada alternativa, se necessário)
    const meses = {
      'janeiro': 1, 'fevereiro': 2, 'março': 3, 'marco': 3, 'abril': 4,
      'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8,
      'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12
    };

    if (!rodada) {
      for (const [mes, num] of Object.entries(meses)) {
        if (fileName.toLowerCase().includes(mes)) {
          console.log(`   ℹ️  Mês encontrado: ${mes} (pode ser usado como referência)`);
          break;
        }
      }
    }

    return { year, rodada };
  }

  /**
   * Extrai ID do entrevistado dos dados
   */
  extractEntrevistadoId(headers, row) {
    // Procurar por colunas comuns de ID
    const idColumns = ['id', 'entrevistado', 'entrevistado_id', 'respondent_id', 'numero'];

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i].toLowerCase().trim();
      if (idColumns.includes(header)) {
        return row[i];
      }
    }

    return null;
  }

  /**
   * Executa migração completa
   */
  async migrateAll() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log(`║   MIGRAÇÃO GOOGLE SHEETS → MongoDB [${this.migrationType.toUpperCase()}]         ║`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    if (this.dryRun) {
      console.log('⚠️  MODO DRY-RUN: Nenhum dado será inserido no MongoDB\n');
    }

    this.stats.startTime = Date.now();

    try {
      // 1. Inicializar Google APIs
      await this.initialize();

      // 2. Migrar índice de perguntas
      await this.migrateQuestionIndex();

      // 3. Migrar dados das pesquisas
      await this.migrateSurveyData();

      // 4. Relatório final
      this.stats.endTime = Date.now();
      this.printFinalReport();

    } catch (error) {
      console.error('\n❌ Erro fatal durante migração:', error);
      throw error;
    }
  }

  /**
   * Imprime relatório final
   */
  printFinalReport() {
    const duration = ((this.stats.endTime - this.stats.startTime) / 1000 / 60).toFixed(2);

    console.log('\n' + '═'.repeat(70));
    console.log('📊 RELATÓRIO FINAL DE MIGRAÇÃO');
    console.log('═'.repeat(70));

    if (this.dryRun) {
      console.log('⚠️  MODO DRY-RUN - Nenhum dado foi inserido\n');
    }

    console.log(`⏱️  Duração total: ${duration} minutos`);
    console.log(`📂 Tipo de migração: ${this.migrationType.toUpperCase()}\n`);

    console.log('📈 ESTATÍSTICAS:');
    console.log(`   Arquivos processados: ${this.stats.processedFiles}/${this.stats.totalFiles}`);
    console.log(`   Question Index:       ${this.stats.questionIndex.toLocaleString()} perguntas`);
    console.log(`   Surveys:              ${this.stats.surveys} surveys`);
    console.log(`   Responses:            ${this.stats.responses.toLocaleString()} respostas\n`);

    if (this.stats.errors.length > 0) {
      console.log('❌ ERROS ENCONTRADOS:');
      this.stats.errors.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.file || err.type}: ${err.error}`);
      });
      console.log('');
    }

    console.log('═'.repeat(70));

    if (!this.dryRun) {
      console.log('\n✅ Migração concluída com sucesso!\n');
    } else {
      console.log('\n✅ Simulação (dry-run) concluída!\n');
      console.log('Para executar a migração real, remova a flag --dry-run\n');
    }
  }
}

// ==================== SCRIPT PRINCIPAL ====================

async function main() {
  const args = process.argv.slice(2);

  // Determinar tipo de migração
  let migrationType = 'telephonic';
  if (args.includes('--f2f')) {
    migrationType = 'f2f';
  }

  const options = {
    type: migrationType,
    dryRun: args.includes('--dry-run'),
  };

  const migration = new GoogleSheetsMigration(options);

  console.log(`\n🚀 Iniciando migração de dados [${migrationType.toUpperCase()}]\n`);

  await migration.migrateAll();
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

module.exports = GoogleSheetsMigration;
