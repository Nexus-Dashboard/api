# 📦 Guia de Exportação de Databases

## 🎯 Objetivo

Exportar todas as databases do MongoDB (F2F e Telephonic) para formatos tabulares (CSV, JSON, Parquet) e compactar em um arquivo ZIP para download.

---

## 🚀 Opções de Exportação

### Opção 1: Via Script (Mais Completo - Com Parquet)

Execute o script standalone que exporta para **3 formatos**: CSV, JSON e Parquet

```bash
node scripts/export-databases.js
```

**O que acontece:**
1. ✅ Conecta aos bancos F2F, Telephonic e Test
2. ✅ Exporta todas as collections (responses, surveys, questionindexes)
3. ✅ Cria arquivos em **3 formatos**:
   - CSV (para Excel/Google Sheets)
   - JSON (backup completo)
   - Parquet (para Python/R/Spark)
4. ✅ Compacta tudo em um arquivo ZIP
5. ✅ Salva em `exports/mongodb_export_[timestamp].zip`

**Resultado:**
```
exports/
└── mongodb_export_2024-12-02T14-30-00.zip
    ├── README.txt
    ├── f2f_responses.csv
    ├── f2f_responses.json
    ├── f2f_responses.parquet
    ├── f2f_surveys.csv
    ├── f2f_surveys.json
    ├── f2f_questionindexes.csv
    ├── f2f_questionindexes.json
    ├── telephonic_responses.csv
    ├── telephonic_responses.json
    ├── telephonic_responses.parquet
    ├── telephonic_surveys.csv
    ├── telephonic_surveys.json
    ├── telephonic_questionindexes.csv
    ├── telephonic_questionindexes.json
    ├── test_responses.csv
    ├── test_responses.json
    └── test_responses.parquet
```

---

### Opção 2: Via API (Mais Rápido - CSV e JSON apenas)

Faça download direto via navegador ou curl

#### Exportar apenas CSV (Recomendado):
```
GET http://localhost:4000/api/migration/export-databases?format=csv
```

#### Exportar apenas JSON:
```
GET http://localhost:4000/api/migration/export-databases?format=json
```

#### Exportar CSV + JSON:
```
GET http://localhost:4000/api/migration/export-databases?format=all
```

**No navegador:**
- Abra: `http://localhost:4000/api/migration/export-databases?format=csv`
- O download do ZIP inicia automaticamente

---

## 📊 Formatos de Saída

### 1. CSV (Comma-Separated Values)

**Ideal para:** Excel, Google Sheets, análise visual

**Exemplo:**
```csv
_id,surveyId,entrevistadoId,rodada,year,P1,P2,P3,...
6687c958acdf3...,6887c959...,180269688,1,2023,Sim,Não,Talvez,...
```

**Como usar:**
1. Extraia o ZIP
2. Abra o arquivo `.csv` com Excel
3. Todas as respostas estão em colunas separadas

**Características:**
- ✅ Responses estão "achatados" (flatten)
- ✅ Cada pergunta (P1, P2, etc.) é uma coluna
- ✅ Fácil de filtrar e analisar

---

### 2. JSON (JavaScript Object Notation)

**Ideal para:** Backup, programação, re-importação

**Exemplo:**
```json
[
  {
    "_id": "6687c958acdf31acf12bdd05",
    "surveyId": "6887c959acdf3...",
    "entrevistadoId": "180269688",
    "answers": [
      { "k": "P1", "v": "Sim" },
      { "k": "P2", "v": "Não" }
    ],
    "rodada": 1,
    "year": 2023
  }
]
```

**Como usar:**
```javascript
const data = require('./f2f_responses.json')
console.log(data.length) // Total de responses
```

**Características:**
- ✅ Mantém estrutura original do MongoDB
- ✅ Inclui arrays aninhados (answers)
- ✅ Perfeito para backup completo

---

### 3. Parquet (Apenas no Script)

**Ideal para:** Python, R, Apache Spark, análise de Big Data

**Exemplo (Python/Pandas):**
```python
import pandas as pd

# Ler arquivo parquet
df = pd.read_parquet('f2f_responses.parquet')

# Analisar dados
print(df.head())
print(df.shape)
print(df.columns)

# Filtrar
responses_2023 = df[df['year'] == 2023]
```

**Características:**
- ✅ Formato colunar otimizado
- ✅ Compressão eficiente
- ✅ Leitura muito rápida
- ✅ Ideal para grandes volumes

---

## 📁 Estrutura dos Dados Exportados

### Collections Exportadas:

#### 1. **responses** (Respostas dos Entrevistados)
- **Campos fixos:**
  - `_id`: ID único da resposta
  - `surveyId`: ID da pesquisa
  - `entrevistadoId`: ID do entrevistado
  - `rodada`: Número da rodada
  - `year`: Ano da pesquisa
  - `createdAt`: Data de criação
  - `updatedAt`: Data de atualização

- **Campos dinâmicos:** (CSV e Parquet)
  - `P1`, `P2`, `P3`, ... : Respostas das perguntas

#### 2. **surveys** (Informações das Pesquisas)
- `_id`: ID da pesquisa
- `name`: Nome da pesquisa
- `year`: Ano
- `month`: Mês/Rodada

#### 3. **questionindexes** (Índice de Perguntas)
- `variable`: Código da pergunta (P1, P2, etc.)
- `questionText`: Texto da pergunta
- `surveyNumber`: Número da pesquisa
- `possibleAnswers`: Respostas possíveis

---

## 💾 Tamanho Estimado dos Arquivos

| Database | Collection | Documentos | CSV | JSON | Parquet |
|----------|-----------|-----------|-----|------|---------|
| F2F | responses | ~53.000 | ~50MB | ~30MB | ~10MB |
| F2F | surveys | ~100 | 10KB | 20KB | - |
| F2F | questionindexes | ~1.500 | 500KB | 1MB | - |
| Telephonic | responses | ~5.000 | ~5MB | ~3MB | ~1MB |
| Telephonic | surveys | ~50 | 5KB | 10KB | - |
| Telephonic | questionindexes | ~1.000 | 300KB | 500KB | - |

**Total ZIP (compactado):** ~20-30MB

---

## 🔄 Processo de "Flatten" (Achatamento)

### Antes (MongoDB/JSON):
```json
{
  "entrevistadoId": "12345",
  "answers": [
    { "k": "P1", "v": "Sim" },
    { "k": "P2", "v": "25" },
    { "k": "P3", "v": "São Paulo" }
  ]
}
```

### Depois (CSV/Parquet):
```csv
entrevistadoId,P1,P2,P3
12345,Sim,25,São Paulo
```

---

## 📖 Exemplos de Uso

### Excel / Google Sheets (CSV)

1. Extraia o ZIP
2. Abra `f2f_responses.csv`
3. Use filtros para analisar:
   - Filtrar por ano
   - Filtrar por rodada
   - Agrupar respostas

### Python (Pandas)

```python
import pandas as pd

# CSV
df = pd.read_csv('f2f_responses.csv')

# Parquet (mais rápido)
df = pd.read_parquet('f2f_responses.parquet')

# Análise
print(df.groupby('year')['entrevistadoId'].count())
print(df['P1'].value_counts())
```

### R (tidyverse)

```r
library(tidyverse)

# CSV
df <- read_csv('f2f_responses.csv')

# Análise
df %>%
  group_by(year) %>%
  summarise(total = n())
```

### JavaScript/Node.js (JSON)

```javascript
const data = require('./f2f_responses.json')

// Total de respostas
console.log(`Total: ${data.length}`)

// Filtrar por ano
const respostas2023 = data.filter(r => r.year === 2023)

// Contar por rodada
const porRodada = data.reduce((acc, r) => {
  acc[r.rodada] = (acc[r.rodada] || 0) + 1
  return acc
}, {})
```

---

## ⚠️ Notas Importantes

1. **Memória:** A exportação carrega todos os dados na memória
   - Se tiver problemas, exporte um banco por vez
   - Use o script que processa em lotes

2. **Formato CSV:**
   - Arrays (answers) são "achatados" em colunas
   - Cada pergunta vira uma coluna (P1, P2, etc.)

3. **Formato JSON:**
   - Mantém estrutura original
   - Arrays ficam aninhados
   - Ideal para backup

4. **Formato Parquet:**
   - Apenas para responses (muito grande)
   - Requer bibliotecas específicas (pandas, arrow)
   - Muito mais eficiente que CSV

---

## 🚨 Troubleshooting

### Erro: "Out of memory"
**Solução:** Use o script ao invés da API, ele processa em lotes

### Arquivo ZIP muito grande
**Solução:** Exporte apenas CSV: `?format=csv`

### Excel não abre CSV corretamente
**Solução:**
1. Abra Excel
2. Vá em Dados → De Texto/CSV
3. Selecione o arquivo
4. Escolha delimitador: vírgula

---

## 💡 Dicas

1. **Para análise rápida:** Use CSV
2. **Para backup:** Use JSON
3. **Para Big Data:** Use Parquet
4. **Para tudo:** Use `format=all`

---

## 📞 Resumo de Comandos

```bash
# Script completo (CSV + JSON + Parquet)
node scripts/export-databases.js

# API - Apenas CSV
curl "http://localhost:4000/api/migration/export-databases?format=csv" -O

# API - CSV + JSON
curl "http://localhost:4000/api/migration/export-databases?format=all" -O
```

---

**Última atualização:** Dezembro 2024
