# Migração de Dados do Google Sheets para MongoDB

Este documento descreve como migrar dados das pesquisas telefônicas e F2F do Google Sheets para os bancos de dados MongoDB.

## Visão Geral

O sistema possui **dois bancos de dados MongoDB**:
- **Telefônico** (`MONGODB_URI`): Para pesquisas telefônicas
- **F2F** (`MONGODB_URI_SECUNDARIO`): Para pesquisas Face-to-Face (presenciais)

## Estrutura dos Dados no Google Drive

### Pesquisas Telefônicas
- **Pasta principal**: `19ECwWCTZX2kvuyOnGT-FMP4BoysmuH8Y`
- **Índice de perguntas**: `1QQsygOl1soLzXOHnovyTP290iLHmRoDE9mdaA2Zz0ek`

### Pesquisas F2F
- **Pasta principal**: `1uwkW5wF7Cm0uVmRirhQc5eQ2Dl6c3qVL`
- **Índice de perguntas**: `1rYFKyVVCOCn_Y6pAXS1AnOZU7F2wzSEAlg-9Oqsr0tk`

## Pré-requisitos

1. Certifique-se de que as variáveis de ambiente estão configuradas no arquivo `.env`:
   ```env
   # MongoDB
   MONGODB_URI=<sua_uri_mongodb_telefonico>
   MONGODB_URI_SECUNDARIO=<sua_uri_mongodb_f2f>

   # Google Service Account
   TYPE=service_account
   PROJECT_ID=<seu_project_id>
   PRIVATE_KEY_ID=<seu_private_key_id>
   PRIVATE_KEY=<sua_private_key>
   SERVICE_ACCOUNT_EMAIL=<seu_service_account_email>
   CLIENT_ID=<seu_client_id>
   AUTH_URI=https://accounts.google.com/o/oauth2/auth
   TOKEN_URI=https://oauth2.googleapis.com/token
   AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
   CLIENT_X509_CERT_URL=<seu_client_cert_url>
   ```

2. A Service Account deve ter permissão de leitura nas pastas e arquivos do Google Drive especificados.

## Comandos Disponíveis

### 1. Simulação (Dry Run)

Use o modo dry-run para verificar o que será migrado **sem inserir dados** no MongoDB:

```bash
# Simular migração de dados telefônicos
npm run migrate:sheets:dry-run

# Simular migração de dados F2F
npm run migrate:sheets:f2f:dry-run
```

### 2. Migração Real

Após verificar com o dry-run, execute a migração real:

```bash
# Migrar dados telefônicos
npm run migrate:sheets:telephonic
# ou simplesmente
npm run migrate:sheets

# Migrar dados F2F
npm run migrate:sheets:f2f
```

## O Que o Script Faz

### 1. Migração do Índice de Perguntas
- Lê o arquivo Google Sheets do índice
- Parseia os cabeçalhos e dados
- **Limpa** o índice existente no MongoDB
- Insere todas as perguntas no modelo `QuestionIndex`

### 2. Migração dos Dados das Pesquisas
Para cada arquivo Google Sheets na pasta:
- Extrai **ano** e **rodada** do nome do arquivo
- Cria ou atualiza o documento **Survey**
- Processa cada linha como um entrevistado
- Mapeia colunas (variáveis) para respostas
- Insere em lotes no modelo **Response**

## Estrutura Esperada dos Arquivos

### Arquivo de Índice de Perguntas
Deve ter as seguintes colunas (ajuste no código se necessário):
- Coluna 0: Survey Number
- Coluna 1: Survey Name
- Coluna 2: Variable (código da pergunta)
- Coluna 3: Question Text
- Coluna 4: Label
- Coluna 5: Theme/Index
- Coluna 6: Methodology
- Coluna 7: Map
- Coluna 8: Sample
- Coluna 9: Date
- Coluna 10: Possible Answers

### Arquivos de Pesquisa
- **Primeira linha**: Cabeçalhos com nomes das variáveis
- **Demais linhas**: Dados dos entrevistados
- O nome do arquivo deve conter o **ano** (formato 20XX) e a **rodada** (ex: "Rodada 44")

Exemplos de nomes válidos:
- `BD - TRACKING - RODADA 44 - 2025 (Google Sheets)`
- `2024 - Rodada 35 (Google Sheets)`

## Modelos de Dados

### QuestionIndex
```javascript
{
  surveyNumber: String,
  surveyName: String,
  variable: String,
  questionText: String,
  label: String,
  index: String,        // theme
  methodology: String,
  map: String,
  sample: String,
  date: String,
  possibleAnswers: [{ value: String, label: String }]
}
```

### Survey
```javascript
{
  name: String,
  year: Number,
  month: Number,        // rodada
  fileHashes: [String]
}
```

### Response
```javascript
{
  surveyId: ObjectId,
  entrevistadoId: String,
  year: Number,
  rodada: Number,
  answers: [{ k: String, v: String }]
}
```

## Processo de Migração

### Passo a Passo Recomendado

1. **Teste com Dry Run**
   ```bash
   npm run migrate:sheets:dry-run
   ```
   Verifique os logs para garantir que:
   - Todos os arquivos foram encontrados
   - Ano e rodada foram extraídos corretamente
   - Número de perguntas e respostas está correto

2. **Execute a Migração de Telefônicas**
   ```bash
   npm run migrate:sheets:telephonic
   ```

3. **Execute a Migração de F2F**
   ```bash
   npm run migrate:sheets:f2f
   ```

4. **Verifique os Dados no MongoDB**
   Use o MongoDB Compass ou execute queries para verificar:
   ```javascript
   // Verificar quantas perguntas foram inseridas
   db.questionindexes.countDocuments()

   // Verificar surveys
   db.surveys.find()

   // Verificar respostas por rodada
   db.responses.countDocuments({ year: 2025, rodada: 44 })
   ```

## Logs e Relatórios

O script gera logs detalhados durante a execução:
- ✅ Sucesso em cada etapa
- ⚠️ Avisos sobre dados ausentes ou problemas menores
- ❌ Erros críticos
- 📊 Relatório final com estatísticas completas

Exemplo de relatório final:
```
═══════════════════════════════════════════════════════════════════
📊 RELATÓRIO FINAL DE MIGRAÇÃO
═══════════════════════════════════════════════════════════════════
⏱️  Duração total: 5.23 minutos
📂 Tipo de migração: TELEPHONIC

📈 ESTATÍSTICAS:
   Arquivos processados: 45/45
   Question Index:       523 perguntas
   Surveys:              45 surveys
   Responses:            125,430 respostas
═══════════════════════════════════════════════════════════════════
```

## Tratamento de Erros

O script é robusto e:
- Continua processando outros arquivos mesmo se um falhar
- Registra todos os erros no relatório final
- Fornece stack trace detalhado em caso de erro fatal

Erros comuns e soluções:
- **Arquivo vazio**: Arquivo será pulado, verificar no Google Drive
- **Ano/rodada não encontrado**: Verificar formato do nome do arquivo
- **Erro de autenticação**: Verificar credenciais no `.env`
- **Timeout do Google**: Executar novamente, o script retomará de onde parou

## Personalização

### Ajustar Mapeamento de Colunas
Se a estrutura do seu índice de perguntas for diferente, edite a função `migrateQuestionIndex()` em [migrate-from-google-sheets.js](scripts/migrate-from-google-sheets.js:158):

```javascript
const question = {
  surveyNumber: row[0] || '',      // Ajuste o índice conforme necessário
  surveyName: row[1] || '',
  variable: row[2] || '',
  // ... resto dos campos
};
```

### Ajustar Extração de ID do Entrevistado
Edite a função `extractEntrevistadoId()` em [migrate-from-google-sheets.js](scripts/migrate-from-google-sheets.js:333):

```javascript
const idColumns = ['id', 'entrevistado', 'entrevistado_id', 'respondent_id', 'numero'];
```

### Ajustar Extração de Ano e Rodada
Edite a função `extractYearAndRodada()` em [migrate-from-google-sheets.js](scripts/migrate-from-google-sheets.js:314):

```javascript
const yearMatch = fileName.match(/20(\d{2})/);
const rodadaMatch = fileName.match(/rodada\s*(\d+)/i);
```

## Segurança

- O modo dry-run **nunca** modifica dados no MongoDB
- A migração real **limpa o índice existente** antes de inserir novos dados
- As respostas são inseridas em lotes para melhor performance
- Use `ordered: false` nas inserções para continuar mesmo com duplicatas

## Perguntas Frequentes

**P: Posso executar a migração múltiplas vezes?**
R: Sim, mas o índice de perguntas será limpo e recriado. As respostas podem gerar duplicatas se não houver validação de unicidade.

**P: Como adicionar validação de duplicatas?**
R: Adicione índices únicos no MongoDB:
```javascript
db.responses.createIndex(
  { surveyId: 1, entrevistadoId: 1, year: 1, rodada: 1 },
  { unique: true }
)
```

**P: O que fazer se a migração falhar no meio?**
R: Execute novamente. Se quiser evitar duplicatas, adicione lógica de verificação antes de inserir.

**P: Como migrar apenas uma rodada específica?**
R: Atualmente não suportado. Você pode filtrar manualmente editando o script ou movendo temporariamente os outros arquivos para outra pasta.

## Próximos Passos

Após a migração bem-sucedida:
1. Verificar integridade dos dados no MongoDB
2. Testar consultas e agregações
3. Configurar índices para melhor performance
4. Considerar migração para BigQuery (use os scripts `bq:*`)

## Suporte

Em caso de problemas:
1. Verifique os logs detalhados do script
2. Teste com `--dry-run` primeiro
3. Verifique credenciais e permissões do Google
4. Confirme que as URIs do MongoDB estão corretas
