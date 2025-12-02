# 🔄 Continuar Migração - Guia Rápido

## 📊 Situação Atual

Você já migrou **10.000 de 53.326** documentos. Restam **43.326 documentos** para migrar.

## ✅ Nova Funcionalidade: Skip Existing

Adicionei o parâmetro `skipExisting` que permite continuar a migração de onde parou, **pulando os documentos já migrados**.

---

## 🚀 Opções para Continuar

### Opção 1: Rota Simplificada (Recomendado)

Use a nova rota `/continue-test-to-f2f` que automaticamente detecta o que falta migrar:

#### 1. Ver status da migração:
```
GET http://localhost:4000/api/migration/continue-test-to-f2f?dryRun=true
```

**Resposta esperada:**
```json
{
  "success": true,
  "message": "Status da migração (modo simulação)",
  "statistics": {
    "totalInTest": 53326,
    "totalInF2F": 10000,
    "remaining": 43326
  },
  "nextStep": "Execute com dryRun=false para continuar"
}
```

#### 2. Continuar migração:
```
GET http://localhost:4000/api/migration/continue-test-to-f2f
```

Isso vai automaticamente:
- ✅ Detectar os 10.000 já migrados
- ✅ Migrar apenas os 43.326 restantes
- ✅ Pular documentos duplicados

---

### Opção 2: Rota Manual (Controle Total)

Use a rota original com o parâmetro `skipExisting=true`:

#### 1. Testar (dry run):
```
GET http://localhost:4000/api/migration/migrate-test-to-f2f?dryRun=true&skipExisting=true
```

**Resposta esperada:**
```json
{
  "success": true,
  "message": "Análise dos dados (modo simulação)",
  "statistics": {
    "totalDocuments": 53326,
    "alreadyMigrated": 10000,
    "documentsToMigrate": 43326
  },
  "warning": "A migração irá processar 43.326 documentos em lotes de 1000",
  "tip": "Modo skipExisting ativado - apenas novos documentos serão migrados"
}
```

#### 2. Executar migração dos restantes:
```
GET http://localhost:4000/api/migration/migrate-test-to-f2f?dryRun=false&skipExisting=true
```

**Resultado esperado:**
```json
{
  "success": true,
  "message": "Migração concluída com sucesso",
  "statistics": {
    "totalDocuments": 53326,
    "processedDocuments": 53326,
    "skippedDocuments": 10000,
    "alreadyMigrated": 10000,
    "insertedDocuments": 43326,
    "errorDocuments": 0
  }
}
```

---

## 🔍 Como Funciona o Skip Existing

1. **Busca IDs existentes:** Busca todos os `_id` já presentes no banco `f2f.responses`
2. **Cria um Set:** Armazena os IDs em memória para verificação rápida
3. **Processa com cursor:** Percorre todos os documentos de `test.responses`
4. **Pula duplicados:** Se o `_id` já existe no Set, pula o documento
5. **Migra apenas novos:** Insere apenas os documentos que ainda não foram migrados

---

## 📝 Parâmetros Disponíveis

| Parâmetro | Valores | Padrão | Descrição |
|-----------|---------|--------|-----------|
| `dryRun` | `true` / `false` | `true` | Modo simulação (não migra) |
| `skipExisting` | `true` / `false` | `false` | Pular documentos já migrados |
| `deleteTest` | `true` / `false` | `false` | Deletar collection test após migração |

---

## 🎯 Comandos Prontos

### Para continuar de onde parou:
```bash
# Ver status
curl http://localhost:4000/api/migration/continue-test-to-f2f?dryRun=true

# Continuar migração
curl http://localhost:4000/api/migration/continue-test-to-f2f
```

### Ou manualmente:
```bash
# Testar
curl "http://localhost:4000/api/migration/migrate-test-to-f2f?dryRun=true&skipExisting=true"

# Executar
curl "http://localhost:4000/api/migration/migrate-test-to-f2f?dryRun=false&skipExisting=true"
```

---

## ⚠️ Importante

- ✅ **Safe:** O modo `skipExisting` é seguro e não duplica dados
- ✅ **Rápido:** Pula documentos já migrados sem precisar validar
- ✅ **Eficiente:** Usa cursor streaming para não sobrecarregar memória
- ⚠️ **IDs preservados:** Assume que os `_id` dos documentos são preservados durante migração

---

## 🔄 Alternativa: Recomeçar do Zero

Se preferir recomeçar completamente:

1. **Deletar os 10.000 já migrados:**
   ```javascript
   // No MongoDB Compass ou Shell
   use f2f
   db.responses.deleteMany({})
   ```

2. **Migrar tudo novamente:**
   ```
   GET http://localhost:4000/api/migration/migrate-test-to-f2f?dryRun=false
   ```

---

## 📊 Monitoramento

Durante a migração com `skipExisting=true`, você verá logs como:

```
🚀 Iniciando migração de dados de 'test.responses' para 'f2f.responses'...
📊 Configurações:
   - Modo simulação: false
   - Deletar collection test após migração: false
   - Pular documentos já existentes: true

📊 Contando documentos na collection 'test.responses'...
   Encontrados 53326 documentos na origem
🔍 Verificando documentos já migrados...
   ✅ 10000 documentos já migrados
   📝 43326 documentos restantes para migrar

💾 Iniciando migração em lotes (processamento com cursor)...
   ⏭️  Progresso: 1000/53326 processados (1000 pulados)
   📦 Inserindo lote 1/44 (1000 documentos) - Processados: 2000/53326
      ✅ 1000 documentos inseridos
   ...
```

---

## 💡 Dica

Execute primeiro com `dryRun=true` para ver quantos documentos faltam antes de iniciar a migração real!

---

**Última atualização:** Dezembro 2024
