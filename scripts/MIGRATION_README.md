# Guia de Migração: Collection Test → F2F

Este guia explica como migrar os dados da collection `test` para a collection `responses` do banco de dados `f2f`.

## 📋 Pré-requisitos

- Node.js instalado
- Arquivo `.env` configurado com as variáveis:
  - `MONGODB_URI` (banco telephonic)
  - `MONGODB_URI_SECUNDARIO` (banco f2f)

## 🔍 Passo 1: Analisar os Dados

Primeiro, execute o script **sem** a flag `--confirm` para analisar a estrutura dos dados:

```bash
node scripts/migrate-test-to-f2f.js
```

Este comando irá:
- Conectar ao banco de dados
- Contar quantos documentos existem na collection `test`
- Mostrar um exemplo da estrutura dos dados
- Listar os campos encontrados
- **NÃO** irá migrar nenhum dado

## ✅ Passo 2: Executar a Migração

Se a análise estiver correta, execute com a flag `--confirm`:

```bash
node scripts/migrate-test-to-f2f.js --confirm
```

Isso irá:
- Validar todos os documentos da collection `test`
- Transformar para o formato correto de `Response`
- Inserir os dados na collection `responses` do banco `f2f`
- Manter os dados originais na collection `test`

## 🗑️ Passo 3 (Opcional): Deletar Dados da Collection Test

Se quiser deletar os dados da collection `test` após a migração bem-sucedida:

```bash
node scripts/migrate-test-to-f2f.js --confirm --delete-test
```

⚠️ **ATENÇÃO**: Esta ação é irreversível!

## 📊 Estrutura dos Dados

### Formato Esperado na Collection Test

```json
{
  "surveyId": "ObjectId",
  "surveyName": "Nome da Pesquisa",
  "entrevistadoId": "ID_123",
  "answers": [
    { "k": "P1", "v": "Resposta 1" },
    { "k": "P2", "v": "Resposta 2" }
  ],
  "rodada": "01",
  "year": 2023
}
```

### Formato de Saída na Collection Responses (F2F)

```json
{
  "surveyId": "ObjectId",
  "entrevistadoId": "ID_123",
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

## 🔧 Tratamento de Erros

O script inclui tratamento para:

1. **Documentos sem surveyId**: Tenta buscar/criar baseado no `surveyName`
2. **Documentos sem respostas**: São marcados como inválidos
3. **Erros de inserção**: Tenta inserir individualmente documentos que falharam em lote
4. **Duplicados**: Ignora e continua com os próximos

## 📝 Logs e Relatórios

O script fornece logs detalhados:
- ✅ Documentos migrados com sucesso
- ❌ Documentos com erro (e motivo do erro)
- 📊 Resumo estatístico da migração

## 🚨 Troubleshooting

### Erro: "Documento sem surveyId ou surveyName"
Alguns documentos não têm identificação da pesquisa. Você precisará corrigi-los manualmente antes da migração.

### Erro: "Documento sem respostas (answers)"
O documento não tem o campo `answers` ou está vazio. Verifique a estrutura dos dados.

### Erro de conexão
Verifique se as variáveis de ambiente estão corretas no arquivo `.env`.

## 🔄 Rollback

Se precisar reverter a migração:
1. Os dados originais estão preservados na collection `test` (a menos que use `--delete-test`)
2. Você pode deletar manualmente os documentos inseridos na collection `responses` do banco `f2f`

## 💡 Dicas

- Execute primeiro sem `--confirm` para garantir que os dados estão corretos
- Faça backup do banco de dados antes de migrar
- Use `--delete-test` apenas após confirmar que a migração foi bem-sucedida
- Em caso de grande volume de dados, o script processa em lotes de 1000 documentos

## 📞 Suporte

Se encontrar problemas durante a migração, verifique:
1. Os logs gerados pelo script
2. A estrutura dos dados na collection `test`
3. As permissões de acesso ao banco de dados
