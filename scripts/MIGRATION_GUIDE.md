# 📚 Guia Completo de Migração: Collection Test → F2F

Este guia fornece **duas formas** de migrar os dados da collection `test` para a collection `responses` do banco de dados F2F.

## 🎯 Objetivo

Migrar todos os dados relacionados às pesquisas F2F que estão na collection `test` para a collection `responses` (ou `f2f.responses`) do banco de dados F2F.

---

## 📋 Pré-requisitos

1. Node.js instalado
2. Arquivo `.env` configurado com:
   - `MONGODB_URI` - Conexão com banco telephonic
   - `MONGODB_URI_SECUNDARIO` - Conexão com banco F2F
3. Servidor da API rodando (para usar a opção HTTP)

---

## 🚀 Opção 1: Via Script de Linha de Comando (Recomendado para grandes volumes)

### Passo 1: Analisar os dados

```bash
node scripts/migrate-test-to-f2f.js
```

**O que acontece:**
- Conecta ao MongoDB
- Conta documentos na collection `test`
- Mostra estrutura dos dados
- Lista campos encontrados
- **NÃO migra** nenhum dado

**Exemplo de saída:**
```
🚀 Iniciando migração de dados de 'test' para 'f2f'...
📊 Contando documentos na collection 'test'...
   Encontrados 1596 documentos para migrar
📥 Buscando documentos da collection 'test'...
✅ 1596 documentos carregados

🔍 Analisando estrutura dos dados...
📋 Exemplo do primeiro documento:
{
  "_id": "691b9b85a23461060fbb284e",
  "variable": "P01",
  "surveyNumber": "1",
  "date": "fev./23",
  ...
}
```

### Passo 2: Executar a migração

```bash
node scripts/migrate-test-to-f2f.js --confirm
```

**O que acontece:**
- Valida todos os documentos
- Transforma para o formato `Response`
- Insere na collection `responses` do banco F2F
- **Mantém** os dados originais na collection `test`

### Passo 3 (Opcional): Deletar dados da collection test

⚠️ **CUIDADO:** Esta ação é irreversível!

```bash
node scripts/migrate-test-to-f2f.js --confirm --delete-test
```

---

## 🌐 Opção 2: Via HTTP/API (Recomendado para uso remoto)

### Passo 1: Analisar os dados

```bash
GET http://localhost:5000/api/migration/analyze-test
```

**Ou via navegador:**
```
http://localhost:5000/api/migration/analyze-test
```

**Resposta JSON:**
```json
{
  "success": true,
  "message": "Análise da collection 'test' concluída",
  "statistics": {
    "totalDocuments": 1596,
    "samplesAnalyzed": 5,
    "uniqueFields": ["_id", "variable", "surveyNumber", "date", ...],
    "fieldOccurrences": {...}
  },
  "structureAnalysis": {
    "hasSurveyId": true,
    "hasSurveyName": false,
    "hasAnswers": true,
    "hasEntrevistadoId": true,
    "hasRodada": true,
    "hasYear": true
  },
  "sampleDocuments": [...],
  "recommendations": [...],
  "nextSteps": [...]
}
```

### Passo 2: Testar a migração (modo simulação)

```bash
GET http://localhost:5000/api/migration/migrate-test-to-f2f?dryRun=true
```

**O que acontece:**
- Analisa os dados
- Valida a estrutura
- **NÃO migra** nenhum dado
- Retorna estatísticas e exemplo

**Resposta JSON:**
```json
{
  "success": true,
  "message": "Análise dos dados (modo simulação)",
  "isDryRun": true,
  "statistics": {
    "totalDocuments": 1596,
    "documentsLoaded": 1596,
    "fields": ["_id", "variable", ...]
  },
  "sampleDocument": {...},
  "nextStep": "Execute com ?dryRun=false para iniciar a migração real"
}
```

### Passo 3: Executar a migração real

```bash
GET http://localhost:5000/api/migration/migrate-test-to-f2f?dryRun=false
```

**Resposta JSON:**
```json
{
  "success": true,
  "message": "Migração concluída com sucesso",
  "statistics": {
    "totalDocuments": 1596,
    "validDocuments": 1596,
    "invalidDocuments": 0,
    "insertedDocuments": 1596,
    "errorDocuments": 0,
    "deletedFromTest": 0
  },
  "settings": {
    "dryRun": false,
    "deleteTest": false
  }
}
```

### Passo 4 (Opcional): Deletar dados da collection test

⚠️ **CUIDADO:** Esta ação é irreversível!

```bash
GET http://localhost:5000/api/migration/migrate-test-to-f2f?dryRun=false&deleteTest=true
```

---

## 📊 Estrutura dos Dados

### Formato de Entrada (Collection Test)

A collection `test` pode ter documentos no formato:

```json
{
  "_id": "ObjectId",
  "surveyId": "ObjectId",           // ou
  "surveyName": "Nome da Pesquisa", // um dos dois é obrigatório
  "entrevistadoId": "12345",
  "answers": [
    { "k": "P1", "v": "Resposta 1" },
    { "k": "P2", "v": "Resposta 2" }
  ],
  "rodada": "01",
  "year": 2023
}
```

### Formato de Saída (Collection Responses - F2F)

Os dados são transformados para:

```json
{
  "_id": "ObjectId",
  "surveyId": "ObjectId",
  "entrevistadoId": "12345",
  "answers": [
    { "k": "P1", "v": "Resposta 1" },
    { "k": "P2", "v": "Resposta 2" }
  ],
  "rodada": "01",
  "year": 2023,
  "createdAt": "2023-11-20T10:00:00.000Z",
  "updatedAt": "2023-11-20T10:00:00.000Z"
}
```

---

## ✅ Validações Realizadas

O script de migração valida:

1. **Survey ID**: Se não existir `surveyId`, tenta usar `surveyName` para buscar/criar
2. **Answers**: Verifica se existem respostas no documento
3. **Entrevistado ID**: Se não existir, cria um ID automático
4. **Duplicados**: Trata erros de duplicação durante a inserção

---

## 🔧 Tratamento de Erros

### Documentos Inválidos

Documentos que não passam nas validações são registrados como inválidos:

```json
{
  "docId": "691b9b85a23461060fbb284e",
  "error": "Documento sem surveyId ou surveyName"
}
```

### Erros de Inserção

Se houver erro em lote, o script tenta inserir documento por documento para identificar problemas específicos.

---

## 🎯 Qual Opção Escolher?

### Use o **Script de Linha de Comando** quando:
- Tiver acesso direto ao servidor
- Quiser ver logs em tempo real
- Tiver grande volume de dados (>10.000 documentos)
- Preferir controle total via terminal

### Use a **API HTTP** quando:
- Estiver trabalhando remotamente
- Quiser integrar com outras ferramentas
- Preferir interface JSON
- Precisar automatizar o processo

---

## 📝 Checklist de Migração

- [ ] 1. Fazer backup do banco de dados
- [ ] 2. Verificar variáveis de ambiente (.env)
- [ ] 3. Analisar a estrutura dos dados
- [ ] 4. Executar migração em modo teste (dryRun)
- [ ] 5. Verificar estatísticas e logs
- [ ] 6. Executar migração real
- [ ] 7. Validar dados migrados no MongoDB
- [ ] 8. (Opcional) Deletar collection test

---

## 🚨 Troubleshooting

### Erro: "Documento sem surveyId ou surveyName"
**Solução:** Adicione manualmente o campo `surveyName` aos documentos antes da migração.

### Erro: "Documento sem respostas (answers)"
**Solução:** Verifique se o campo `answers` existe e não está vazio.

### Erro: "Connection timeout"
**Solução:** Verifique as credenciais no arquivo `.env` e a conectividade com MongoDB.

### Documentos duplicados
**Solução:** O script ignora duplicados automaticamente e continua com os próximos.

---

## 🔄 Rollback

Se precisar reverter:

1. **Os dados originais estão na collection `test`** (se não usou `--delete-test`)
2. Para remover dados migrados:

```javascript
// No MongoDB Shell ou Compass
use f2f
db.responses.deleteMany({
  createdAt: { $gte: ISODate("2023-XX-XXT00:00:00Z") }
})
```

---

## 💡 Dicas e Boas Práticas

1. **Sempre faça backup antes de migrar**
2. **Execute primeiro em modo teste (dryRun)**
3. **Valide alguns documentos manualmente após a migração**
4. **Use `--delete-test` apenas após confirmar sucesso**
5. **Monitore logs durante a migração**
6. **Em caso de grandes volumes, considere migrar em partes**

---

## 📞 Suporte

Em caso de dúvidas ou problemas:

1. Verifique os logs gerados pelo script
2. Revise a estrutura dos dados na collection `test`
3. Confirme as permissões de acesso ao banco de dados
4. Teste a conexão com ambos os bancos (telephonic e f2f)

---

## 📌 Arquivos Relacionados

- [migrate-test-to-f2f.js](./migrate-test-to-f2f.js) - Script de migração
- [migrationRoutes.js](../routes/migrationRoutes.js) - Rotas HTTP
- [Response.js](../models/Response.js) - Model do Mongoose
- [dbManager.js](../config/dbManager.js) - Gerenciador de conexões

---

**Última atualização:** Dezembro 2024
