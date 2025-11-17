# Migração de Cluster MongoDB

Este documento explica a solução para o problema de **falta de espaço** no cluster telefônico e como migrar tudo para o cluster F2F.

## 🎯 Objetivo

Migrar todos os dados do **Cluster0** (sem espaço) para o **ClusterMarcos** (com espaço), mantendo a separação lógica entre dados telefônicos e F2F.

## 🏗️ Arquitetura da Solução

### Antes (Problema)
```
Cluster0 (SEM ESPAÇO) ❌
├─ Database: test
   ├─ questionindexes
   ├─ surveys
   ├─ responses
   └─ users

ClusterMarcos (COM ESPAÇO) ✅
├─ Database: test
   ├─ questionindexes
   ├─ surveys
   ├─ responses
   └─ users
```

### Depois (Solução) ✅
```
ClusterMarcos (COM ESPAÇO) ✅
├─ Database: telephonic    ← Dados telefônicos
│  ├─ questionindexes
│  ├─ surveys
│  ├─ responses
│  └─ users
│
└─ Database: f2f          ← Dados F2F
   ├─ questionindexes
   ├─ surveys
   ├─ responses
   └─ users
```

## ✨ Vantagens desta Solução

✅ **Separação Lógica Clara**
- Databases diferentes para telefônico e F2F
- Fácil de entender e gerenciar

✅ **Sem Modificação de Código**
- Models permanecem iguais
- Apenas URIs de conexão mudam
- Zero refatoração necessária

✅ **Escalabilidade**
- Todo o espaço do ClusterMarcos disponível
- Pode crescer sem problemas

✅ **Facilidade de Manutenção**
- Backup/restore independente
- Índices específicos por database
- Monitoramento separado

✅ **Compatibilidade Total**
- O `dbManager.js` já suporta databases diferentes
- Apenas mudança nas variáveis de ambiente

## 📋 Passos da Migração

### 1. Atualizar Variáveis de Ambiente

As URIs no `.env` já foram atualizadas para:

```env
# NOVO: Ambos os databases no ClusterMarcos (com espaço disponível)
MONGODB_URI=mongodb+srv://marcossantos:tsvQp2NSFhgr7Cqg@clustermarcos.hld4nnl.mongodb.net/telephonic?retryWrites=true&w=majority&appName=ClusterMarcos
MONGODB_URI_secundario=mongodb+srv://marcossantos:tsvQp2NSFhgr7Cqg@clustermarcos.hld4nnl.mongodb.net/f2f?retryWrites=true&w=majority&appName=ClusterMarcos
```

**Observe:**
- Ambas usam o **mesmo cluster** (`ClusterMarcos`)
- Mas **databases diferentes**: `/telephonic` e `/f2f`
- Mesmas credenciais para ambos

### 2. Executar Migração de Dados

Execute o script de migração:

```bash
npm run migrate:cluster
```

Este script vai:
1. ✅ Conectar ao cluster antigo (Cluster0)
2. ✅ Conectar ao cluster novo (ClusterMarcos/telephonic)
3. ✅ Migrar **Users** (mantendo senhas hash)
4. ✅ Migrar QuestionIndex
5. ✅ Migrar Surveys
6. ✅ Migrar Responses
7. ✅ Verificar integridade
8. ✅ Gerar relatório final

**Tempo estimado:** 5-15 minutos (dependendo do volume de Responses)

### 3. Verificar Migração

Após a migração, verifique no **MongoDB Compass**:

1. Conecte ao ClusterMarcos
2. Verifique que existem **dois databases**:
   - `telephonic` (dados migrados do Cluster0)
   - `f2f` (dados já existentes)
3. Compare as contagens:
   ```javascript
   // No telephonic
   db.users.countDocuments()
   db.questionindexes.countDocuments()
   db.surveys.countDocuments()
   db.responses.countDocuments()
   ```

### 4. Testar Aplicação

```bash
# Iniciar servidor
npm start

# Testar endpoints telefônicos
# Testar endpoints F2F
```

A aplicação deve funcionar **exatamente igual**, pois o `dbManager.js` já sabe lidar com databases separados.

### 5. Migrar Novos Dados do Google Sheets

Agora você pode popular os databases com os dados do Google Sheets:

```bash
# Migrar dados telefônicos do Google Sheets
npm run migrate:sheets:telephonic

# Migrar dados F2F do Google Sheets
npm run migrate:sheets:f2f
```

## 🔧 Como Funciona o dbManager.js

O `dbManager.js` já está preparado para isso:

```javascript
async function connectToDatabase(dbKey = "telephonic") {
  // ...
  // Seleciona a URI com base na chave
  const uri = dbKey === "f2f"
    ? process.env.MONGODB_URI_SECUNDARIO  // ClusterMarcos/f2f
    : process.env.MONGODB_URI;            // ClusterMarcos/telephonic
  // ...
}
```

**Uso no código:**
```javascript
// Buscar dados telefônicos
const QuestionIndex = await getModel('QuestionIndex', 'telephonic');

// Buscar dados F2F
const QuestionIndex = await getModel('QuestionIndex', 'f2f');
```

## 📊 Estrutura dos Databases

### Database: `telephonic`
```
Collections:
├─ users              (usuários do sistema - migrados do Cluster0)
├─ questionindexes    (índice de perguntas telefônicas)
├─ surveys            (surveys telefônicas)
└─ responses          (respostas telefônicas)
```

### Database: `f2f`
```
Collections:
├─ users              (pode ser vazio ou ter seus próprios usuários)
├─ questionindexes    (índice de perguntas F2F)
├─ surveys            (surveys F2F)
└─ responses          (respostas F2F)
```

**Nota sobre Users:**
- Os usuários foram migrados para o database `telephonic`
- **Por padrão, o sistema usa o database `f2f`** para todas as operações
- Para usar dados telefônicos, adicione `?type=telephonic` nas requisições de dados
- Auth e User sempre usam o database onde os users estão (padrão `f2f`)

## 🚨 Comparação: Databases vs Collections Separadas

### ❌ Opção NÃO Recomendada: Collections Separadas
```javascript
// Precisaria modificar TODOS os models
const QuestionIndexTelephonic = mongoose.model('QuestionIndex_Telephonic', schema);
const QuestionIndexF2F = mongoose.model('QuestionIndex_F2F', schema);

// Precisaria modificar TODAS as queries
const data = await QuestionIndex_Telephonic.find(...);
```

**Problemas:**
- Muito código para modificar
- Duplicação de models
- Difícil de manter
- Propenso a erros

### ✅ Opção Recomendada: Databases Separados
```javascript
// Nenhuma modificação nos models necessária
const QuestionIndex = mongoose.model('QuestionIndex', schema);

// Apenas escolher qual database usar
const model = await getModel('QuestionIndex', 'telephonic'); // ou 'f2f'
```

**Vantagens:**
- Zero modificação de código
- Um único model
- Fácil de manter
- Funciona com código existente

## 🔐 Segurança e Backup

### Backup Antes da Migração
```bash
# Fazer backup do Cluster0 antes de migrar
mongodump --uri="mongodb+srv://admin:AHj4XyQ5oxO6gzLY@cluster0.4svobfi.mongodb.net/" --out=backup-cluster0
```

### Backup Após Migração
```bash
# Backup do database telephonic
mongodump --uri="mongodb+srv://marcossantos:tsvQp2NSFhgr7Cqg@clustermarcos.hld4nnl.mongodb.net/telephonic" --out=backup-telephonic

# Backup do database f2f
mongodump --uri="mongodb+srv://marcossantos:tsvQp2NSFhgr7Cqg@clustermarcos.hld4nnl.mongodb.net/f2f" --out=backup-f2f
```

## 📈 Monitoramento

Após a migração, monitore:

1. **Uso de espaço** no ClusterMarcos
2. **Performance das queries**
3. **Latência de resposta**
4. **Erros de conexão**

## 🎉 Após Migração Bem-Sucedida

Quando tudo estiver funcionando:

1. ✅ Testar aplicação completamente
2. ✅ Verificar todos os endpoints
3. ✅ Confirmar que ambos databases funcionam
4. ✅ Fazer backup completo
5. ✅ **Desativar** Cluster0 (economizar custos)

## ❓ Perguntas Frequentes

### P: Os dados F2F existentes serão afetados?
R: **Não**. O database `f2f` permanece intacto. Apenas estamos adicionando o database `telephonic` ao lado.

### P: Preciso modificar algum código?
R: **Não**. O `dbManager.js` já suporta esta arquitetura. Apenas as URIs mudaram.

### P: Posso reverter se algo der errado?
R: **Sim**. Basta voltar as URIs antigas no `.env` e o Cluster0 ainda terá os dados originais.

### P: O que fazer com o Cluster0 depois?
R: Após confirmar que tudo funciona no ClusterMarcos, você pode:
1. Manter como backup (por um tempo)
2. Exportar dados finais
3. Desativar cluster (economizar custos)

### P: E se eu quiser adicionar mais tipos no futuro (ex: "online")?
R: Fácil! Basta:
1. Criar novo database: `/online`
2. Adicionar variável de ambiente: `MONGODB_URI_ONLINE`
3. Usar: `getModel('QuestionIndex', 'online')`

## 🛠️ Troubleshooting

### Erro: "Authentication failed"
```bash
# Verificar credenciais do ClusterMarcos
# Confirmar que o usuário tem permissões em ambos databases
```

### Erro: "Database not found"
```bash
# Os databases são criados automaticamente quando você insere dados
# Não precisa criar manualmente
```

### Migração muito lenta
```bash
# Responses é a maior coleção (pode demorar)
# O script usa streaming para economizar memória
# Aguarde... pode levar 10-15 minutos
```

## 📞 Resumo Executivo

**Problema:** Cluster telefônico sem espaço

**Solução:** Migrar tudo para ClusterMarcos usando databases separados
- `telephonic` → dados telefônicos
- `f2f` → dados F2F

**Vantagens:**
- ✅ Sem modificação de código
- ✅ Separação lógica clara
- ✅ Escalável
- ✅ Fácil de manter

**Passos:**
1. URIs já atualizadas no `.env`
2. Execute: `npm run migrate:cluster`
3. Verifique no MongoDB Compass
4. Teste a aplicação
5. Desative Cluster0 quando confirmar

**Tempo:** ~15-20 minutos total
