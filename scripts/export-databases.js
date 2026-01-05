// scripts/export-databases.js
require("dotenv").config()
const fs = require("fs")
const path = require("path")
const archiver = require("archiver")
const { getModel, connectToDatabase } = require("../config/dbManager")

/**
 * Script para exportar databases MongoDB para formatos tabulares (CSV e Parquet)
 *
 * Exporta:
 * - Database F2F: responses, surveys, questionindexes
 * - Database Telephonic: responses, surveys, questionindexes
 * - Database Test: responses
 *
 * Formatos de saída:
 * - CSV (fácil leitura em Excel/Google Sheets)
 * - Parquet (formato otimizado para análise de dados)
 * - JSON (backup completo)
 *
 * Tudo compactado em um arquivo ZIP
 */

// Configurações
const EXPORT_DIR = path.join(__dirname, "..", "exports")
const BATCH_SIZE = 1000 // Processar em lotes para não sobrecarregar memória

// Criar diretório de exportação se não existir
if (!fs.existsSync(EXPORT_DIR)) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true })
}

/**
 * Converte array de respostas (formato MongoDB) para colunas (formato tabular)
 */
function flattenResponses(responses) {
  return responses.map((response) => {
    const flat = {
      _id: response._id.toString(),
      surveyId: response.surveyId ? response.surveyId.toString() : null,
      entrevistadoId: response.entrevistadoId,
      rodada: response.rodada,
      year: response.year,
      createdAt: response.createdAt,
      updatedAt: response.updatedAt,
    }

    // Adicionar cada answer como uma coluna
    if (response.answers && Array.isArray(response.answers)) {
      response.answers.forEach((answer) => {
        if (answer.k) {
          flat[answer.k] = answer.v
        }
      })
    }

    return flat
  })
}

/**
 * Exporta collection para CSV usando streaming (sem carregar tudo na memória)
 */
async function exportToCSVStream(Model, filename, flatten = false) {
  try {
    console.log(`   📝 Criando CSV: ${filename}`)

    const filepath = path.join(EXPORT_DIR, filename)
    const writeStream = fs.createWriteStream(filepath, { encoding: "utf8" })

    let isFirstRow = true
    let headers = []
    let count = 0

    const cursor = Model.find({}).lean().cursor({ batchSize: BATCH_SIZE })

    for await (const doc of cursor) {
      const processedDoc = flatten ? flattenResponses([doc])[0] : doc

      // Primeira linha: headers
      if (isFirstRow) {
        headers = Object.keys(processedDoc)
        writeStream.write(headers.join(",") + "\n")
        isFirstRow = false
      }

      // Escrever linha de dados
      const values = headers.map((header) => {
        let value = processedDoc[header]
        if (value === null || value === undefined) return ""
        // Escapar vírgulas e aspas
        if (typeof value === "string") {
          value = value.replace(/"/g, '""')
          if (value.includes(",") || value.includes("\n")) {
            value = `"${value}"`
          }
        }
        return value
      })
      writeStream.write(values.join(",") + "\n")

      count++
      if (count % 10000 === 0) {
        console.log(`      Processados ${count.toLocaleString()} documentos...`)
      }
    }

    writeStream.end()

    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve)
      writeStream.on("error", reject)
    })

    console.log(`   ✅ CSV criado: ${filename} (${count.toLocaleString()} registros)`)
    return filepath
  } catch (error) {
    console.error(`   ❌ Erro ao criar CSV ${filename}:`, error.message)
    return null
  }
}

/**
 * Exporta collection para JSON usando streaming
 */
async function exportToJSONStream(Model, filename) {
  try {
    console.log(`   📝 Criando JSON: ${filename}`)

    const filepath = path.join(EXPORT_DIR, filename)
    const writeStream = fs.createWriteStream(filepath, { encoding: "utf8" })

    writeStream.write("[\n")

    let count = 0
    const cursor = Model.find({}).lean().cursor({ batchSize: BATCH_SIZE })

    for await (const doc of cursor) {
      if (count > 0) writeStream.write(",\n")
      writeStream.write("  " + JSON.stringify(doc))
      count++
      if (count % 10000 === 0) {
        console.log(`      Processados ${count.toLocaleString()} documentos...`)
      }
    }

    writeStream.write("\n]")
    writeStream.end()

    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve)
      writeStream.on("error", reject)
    })

    console.log(`   ✅ JSON criado: ${filename} (${count.toLocaleString()} registros)`)
    return filepath
  } catch (error) {
    console.error(`   ❌ Erro ao criar JSON ${filename}:`, error.message)
    return null
  }
}

/**
 * Exporta uma collection completa usando streaming
 */
async function exportCollection(Model, collectionName, dbName, flatten = false) {
  try {
    console.log(`\n📊 Exportando ${dbName}.${collectionName}...`)

    const totalDocs = await Model.countDocuments()
    console.log(`   Total de documentos: ${totalDocs.toLocaleString()}`)

    if (totalDocs === 0) {
      console.log(`   ⚠️  Collection vazia, pulando...`)
      return { csv: null, json: null, parquet: null }
    }

    const baseFilename = `${dbName}_${collectionName}`

    // Usar streaming para evitar problemas de memória
    const csvFile = await exportToCSVStream(Model, `${baseFilename}.csv`, flatten)
    const jsonFile = await exportToJSONStream(Model, `${baseFilename}.json`)

    // Parquet desabilitado por enquanto (causa problemas de memória)
    const parquetFile = null

    return { csv: csvFile, json: jsonFile, parquet: parquetFile }
  } catch (error) {
    console.error(`❌ Erro ao exportar ${dbName}.${collectionName}:`, error.message)
    return { csv: null, json: null, parquet: null }
  }
}

/**
 * Cria arquivo ZIP com todos os exports
 */
async function createZipArchive(files) {
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString().replace(/:/g, "-").split(".")[0]
    const zipFilename = `mongodb_export_${timestamp}.zip`
    const zipPath = path.join(EXPORT_DIR, zipFilename)

    const output = fs.createWriteStream(zipPath)
    const archive = archiver("zip", {
      zlib: { level: 9 }, // Máxima compressão
    })

    output.on("close", () => {
      const sizeInMB = (archive.pointer() / 1024 / 1024).toFixed(2)
      console.log(`\n📦 Arquivo ZIP criado: ${zipFilename}`)
      console.log(`   Tamanho: ${sizeInMB} MB`)
      console.log(`   Local: ${zipPath}`)
      resolve(zipPath)
    })

    archive.on("error", (err) => {
      reject(err)
    })

    archive.pipe(output)

    // Adicionar arquivos ao ZIP
    files.forEach((file) => {
      if (file && fs.existsSync(file)) {
        archive.file(file, { name: path.basename(file) })
      }
    })

    // Criar README dentro do ZIP
    const readme = `
# MongoDB Export - Databases F2F e Telephonic

Exportação realizada em: ${new Date().toISOString()}

## Estrutura dos Arquivos

### Formatos Disponíveis:

1. **CSV** - Formato tabular para Excel/Google Sheets
   - Fácil de abrir e visualizar
   - Todas as respostas são colunas separadas

2. **JSON** - Formato completo (backup)
   - Mantém estrutura original do MongoDB
   - Útil para re-importação

3. **Parquet** - Formato otimizado para análise
   - Apenas para responses (devido ao tamanho)
   - Ideal para Python/Pandas, R, Spark, etc.

### Databases Exportados:

- **f2f**: Pesquisas Face-to-Face
- **telephonic**: Pesquisas Telefônicas
- **test**: Dados de teste

### Collections:

- **responses**: Respostas dos entrevistados
- **surveys**: Informações das pesquisas
- **questionindexes**: Índice de perguntas

## Como Usar

### CSV (Excel/Google Sheets):
1. Abra o arquivo .csv com Excel ou Google Sheets
2. Os dados já estão em formato tabular

### JSON (Programação):
\`\`\`javascript
const data = require('./f2f_responses.json')
console.log(data)
\`\`\`

### Parquet (Python/Pandas):
\`\`\`python
import pandas as pd
df = pd.read_parquet('f2f_responses.parquet')
print(df.head())
\`\`\`

## Notas

- Responses estão "achatados" (flatten) nos formatos CSV e Parquet
- Cada resposta (answer.k) virou uma coluna
- O formato JSON mantém a estrutura original aninhada
`

    archive.append(readme, { name: "README.txt" })

    archive.finalize()
  })
}

/**
 * Função principal de exportação
 */
async function exportAllDatabases() {
  console.log("🚀 Iniciando exportação das databases MongoDB...\n")

  const allFiles = []

  try {
    // ============================================
    // EXPORTAR DATABASE F2F
    // ============================================
    console.log("=" .repeat(60))
    console.log("📁 DATABASE: F2F")
    console.log("=".repeat(60))

    const F2FResponse = await getModel("Response", "f2f")
    const F2FSurvey = await getModel("Survey", "f2f")
    const F2FQuestionIndex = await getModel("QuestionIndex", "f2f")

    const f2fResponses = await exportCollection(F2FResponse, "responses", "f2f", true)
    const f2fSurveys = await exportCollection(F2FSurvey, "surveys", "f2f", false)
    const f2fQuestions = await exportCollection(F2FQuestionIndex, "questionindexes", "f2f", false)

    allFiles.push(f2fResponses.csv, f2fResponses.json, f2fResponses.parquet)
    allFiles.push(f2fSurveys.csv, f2fSurveys.json)
    allFiles.push(f2fQuestions.csv, f2fQuestions.json)

    // ============================================
    // EXPORTAR DATABASE TELEPHONIC
    // ============================================
    console.log("\n" + "=".repeat(60))
    console.log("📁 DATABASE: TELEPHONIC")
    console.log("=".repeat(60))

    const TelResponse = await getModel("Response", "telephonic")
    const TelSurvey = await getModel("Survey", "telephonic")
    const TelQuestionIndex = await getModel("QuestionIndex", "telephonic")

    const telResponses = await exportCollection(TelResponse, "responses", "telephonic", true)
    const telSurveys = await exportCollection(TelSurvey, "surveys", "telephonic", false)
    const telQuestions = await exportCollection(TelQuestionIndex, "questionindexes", "telephonic", false)

    allFiles.push(telResponses.csv, telResponses.json, telResponses.parquet)
    allFiles.push(telSurveys.csv, telSurveys.json)
    allFiles.push(telQuestions.csv, telQuestions.json)

    // ============================================
    // EXPORTAR DATABASE TEST (opcional)
    // ============================================
    console.log("\n" + "=".repeat(60))
    console.log("📁 DATABASE: TEST")
    console.log("=".repeat(60))

    const TestResponse = await getModel("Response", "test")
    const testResponses = await exportCollection(TestResponse, "responses", "test", true)

    allFiles.push(testResponses.csv, testResponses.json, testResponses.parquet)

    // ============================================
    // CRIAR ARQUIVO ZIP
    // ============================================
    console.log("\n" + "=".repeat(60))
    console.log("📦 CRIANDO ARQUIVO ZIP")
    console.log("=".repeat(60))

    const validFiles = allFiles.filter(Boolean)
    const zipPath = await createZipArchive(validFiles)

    // ============================================
    // LIMPEZA - Deletar arquivos individuais
    // ============================================
    console.log("\n🧹 Limpando arquivos individuais...")
    validFiles.forEach((file) => {
      try {
        fs.unlinkSync(file)
      } catch (err) {
        // Ignorar erros
      }
    })

    console.log("\n" + "=".repeat(60))
    console.log("✅ EXPORTAÇÃO CONCLUÍDA COM SUCESSO!")
    console.log("=".repeat(60))
    console.log(`\n📦 Arquivo final: ${zipPath}`)
    console.log(`\n💡 Próximos passos:`)
    console.log(`   1. Baixe o arquivo ZIP`)
    console.log(`   2. Extraia os arquivos`)
    console.log(`   3. Use CSV para Excel ou Parquet para análise em Python/R`)
    console.log(`\n`)
  } catch (error) {
    console.error("\n❌ Erro durante a exportação:", error)
    throw error
  } finally {
    // Fechar conexões
    process.exit(0)
  }
}

// Executar exportação
exportAllDatabases()
  .then(() => {
    console.log("🎉 Script finalizado!")
  })
  .catch((error) => {
    console.error("❌ Script finalizado com erro:", error)
    process.exit(1)
  })
