# ⚡ Quick Start - Migração Test → F2F

## 🎯 Resumo

Migrar dados da collection `test` para collection `responses` do banco F2F.

---

## 🚀 Método Rápido via API

### 1️⃣ Analisar dados
```
GET http://localhost:5000/api/migration/analyze-test
```

### 2️⃣ Testar migração
```
GET http://localhost:5000/api/migration/migrate-test-to-f2f?dryRun=true
```

### 3️⃣ Migrar dados
```
GET http://localhost:5000/api/migration/migrate-test-to-f2f?dryRun=false
```

### 4️⃣ (Opcional) Deletar collection test
```
GET http://localhost:5000/api/migration/migrate-test-to-f2f?dryRun=false&deleteTest=true
```

---

## 💻 Método via Script

### 1️⃣ Analisar dados
```bash
node scripts/migrate-test-to-f2f.js
```

### 2️⃣ Migrar dados
```bash
node scripts/migrate-test-to-f2f.js --confirm
```

### 3️⃣ (Opcional) Migrar e deletar test
```bash
node scripts/migrate-test-to-f2f.js --confirm --delete-test
```

---

## 📝 Notas Importantes

- ✅ **Sempre analise antes de migrar**
- ✅ **Faça backup do banco de dados**
- ✅ **Teste primeiro com dryRun=true**
- ⚠️ **deleteTest é irreversível**

---

## 📚 Documentação Completa

Consulte [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) para instruções detalhadas.
