// routes/migrationRoutes.js
const express = require("express")
const router = express.Router()
const GoogleDriveService = require("../services/googleDriveService")
const { getModel } = require("../config/dbManager")
const { parseDictionarySheet } = require("../services/dictionaryParserService")

let driveService
let serviceInitialized = false

const ensureServiceInitialized = async (req, res, next) => {
  if (serviceInitialized) return next()
  try {
    driveService = new GoogleDriveService()
    await driveService.initialize()
    serviceInitialized = true
    next()
  } catch (error) {
    console.error("Erro ao inicializar serviço Google:", error)
    res.status(500).json({ error: "Erro ao conectar com Google Drive", details: error.message })
  }
}

// Função para normalizar a variável (ex: P01 -> P1)
const normalizeVariable = (variable) => {
  if (typeof variable !== "string") return ""
  // Remove o zero à esquerda se for P01-P09, mas mantém P10, P11, etc.
  return variable.replace(/^P0(\d)$/, "P$1")
}

// Função para introduzir um atraso
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// POST /api/migration/sync-index
// Sincroniza o índice de perguntas para o banco de dados PRINCIPAL
router.get("/sync-index", ensureServiceInitialized, async (req, res) => {
  try {
    const QuestionIndex = await getModel("QuestionIndex") // Sempre no principal
    const indexFileId = "1FurphB54po2Pu-ganTcYqHTMZ7leHuWl_g9hodmhAco"
    console.log(`Iniciando sincronização do índice de perguntas para o banco principal...`)

    const fileData = await driveService.readGoogleSheetsFile(indexFileId)
    const sheet = fileData.sheets["base"]

    if (!sheet || sheet.length < 2) {
      return res.status(400).json({ error: "Planilha de índice não encontrada ou vazia." })
    }

    const headers = sheet[0].map((h) => h.trim())
    const rows = sheet.slice(1)

    const operations = rows
      .map((row) => {
        const doc = {
          surveyNumber: row[headers.indexOf("Número da Pesquisa")],
          surveyName: row[headers.indexOf("Arquivo do BD")],
          variable: row[headers.indexOf("Variável")],
          questionText: row[headers.indexOf("Texto da Pergunta")],
          label: row[headers.indexOf("Rótulo")],
          index: row[headers.indexOf("Index")],
          methodology: row[headers.indexOf("Metodologia")],
          map: row[headers.indexOf("Mapa")],
          sample: row[headers.indexOf("Amostra")],
          date: row[headers.indexOf("Data")],
        }
        if (!doc.variable) return null
        return {
          updateOne: {
            filter: { surveyNumber: doc.surveyNumber, variable: doc.variable },
            update: { $set: doc },
            upsert: true,
          },
        }
      })
      .filter(Boolean)

    if (operations.length === 0) {
      return res.status(200).json({ message: "Nenhum dado válido para sincronizar." })
    }

    const result = await QuestionIndex.bulkWrite(operations)
    console.log("Sincronização do índice concluída.")
    res.status(200).json({ message: "Índice de perguntas sincronizado com sucesso!", ...result })
  } catch (error) {
    console.error("Erro ao sincronizar índice de perguntas:", error)
    res.status(500).json({ error: "Erro interno no servidor.", details: error.message })
  }
})

// POST /api/migration/sync-index-answers
// Sincroniza as respostas possíveis do dicionário para o índice de perguntas
router.get("/sync-index-answers", ensureServiceInitialized, async (req, res) => {
  try {
    console.log("Iniciando sincronização de respostas para o índice...")

    // 1. Fetch and parse all dictionaries SEQUENTIALLY to avoid quota limits
    console.log("Buscando e processando dicionários (sequencialmente)...")
    const dictionaryFilesMap = await driveService.listAllDictionaryFiles() // { rodada: fileId }
    const dictionariesByRodada = {}

    const rodadas = Object.keys(dictionaryFilesMap)
    for (const rodada of rodadas) {
      const fileId = dictionaryFilesMap[rodada]
      console.log(`Processando dicionário da Rodada ${rodada} (ID: ${fileId})`)
      try {
        const dictionaryData = await driveService.readGoogleSheetsFile(fileId)
        if (dictionaryData.sheets["Sheet1"]) {
          dictionariesByRodada[rodada] = parseDictionarySheet(dictionaryData)
          console.log(`  -> Dicionário da Rodada ${rodada} processado com sucesso.`)
        } else {
          console.warn(`⚠️  Aba 'Sheet1' não encontrada no dicionário da Rodada ${rodada}`)
        }
      } catch (e) {
        console.error(`Erro ao processar dicionário da Rodada ${rodada}:`, e.message)
      }
      // Adiciona um atraso de 1.5 segundos entre cada requisição para não exceder a cota
      await delay(1500)
    }
    console.log(`Total de ${Object.keys(dictionariesByRodada).length} dicionários processados.`)

    // 2. Get the model and fetch all questions
    const QuestionIndex = await getModel("QuestionIndex") // Always update the main index
    console.log("Buscando todas as perguntas do índice principal...")
    const allQuestions = await QuestionIndex.find({}).lean()
    console.log(`Encontradas ${allQuestions.length} perguntas para atualizar.`)

    // 3. Prepare bulk update operations with normalized variable keys
    const operations = allQuestions
      .map((question) => {
        const surveyNumber = question.surveyNumber
        // Normaliza a variável da pergunta (ex: P01 -> P1)
        const normalizedVar = normalizeVariable(question.variable)
        let possibleAnswers = []

        if (surveyNumber && normalizedVar && dictionariesByRodada[surveyNumber]) {
          const dictionaryForRodada = dictionariesByRodada[surveyNumber]
          // Tenta encontrar a variável normalizada no dicionário
          if (dictionaryForRodada[normalizedVar]) {
            possibleAnswers = dictionaryForRodada[normalizedVar]
          }
        }

        // Só atualiza se encontrou novas respostas e antes não tinha nenhuma
        if (possibleAnswers.length > 0 && question.possibleAnswers.length === 0) {
          return {
            updateOne: {
              filter: { _id: question._id },
              update: { $set: { possibleAnswers: possibleAnswers } },
            },
          }
        }
        return null // Não faz nada se não encontrou respostas ou se já tinha
      })
      .filter(Boolean) // Remove os nulos

    if (operations.length === 0) {
      return res.status(200).json({
        message: "Nenhuma pergunta nova para atualizar com respostas. A sincronização pode já estar completa.",
        updatedCount: 0,
      })
    }

    // 4. Execute bulk write
    console.log(`Preparando para atualizar ${operations.length} documentos com novas respostas...`)
    const result = await QuestionIndex.bulkWrite(operations)
    console.log("Sincronização de respostas do índice concluída.")
    res.status(200).json({
      message: "Respostas do índice sincronizadas com sucesso!",
      updatedCount: result.modifiedCount,
    })
  } catch (error) {
    console.error("Erro ao sincronizar respostas do índice:", error)
    res.status(500).json({ error: "Erro interno no servidor.", details: error.message })
  }
})

// POST /api/migration/update-variables
// Atualiza o campo variable no QuestionIndex com os valores da planilha
router.post("/update-variables", ensureServiceInitialized, async (req, res) => {
  try {
    console.log("Iniciando atualização de variáveis no índice...")

    const QuestionIndex = await getModel("QuestionIndex")
    const indexFileId = "1FurphB54po2Pu-ganTcYqHTMZ7leHuWl_g9hodmhAco"

    console.log("Lendo arquivo de índice atualizado...")
    const fileData = await driveService.readGoogleSheetsFile(indexFileId)
    const sheet = fileData.sheets["base"]

    if (!sheet || sheet.length < 2) {
      return res.status(400).json({ error: "Planilha de índice não encontrada ou vazia." })
    }

    const headers = sheet[0].map((h) => h.trim())
    const rows = sheet.slice(1)

    console.log(`Processando ${rows.length} linhas da planilha...`)

    // Preparar operações em lote usando bulkWrite para melhor performance
    const operations = rows
      .map((row) => {
        const surveyNumber = row[headers.indexOf("Número da Pesquisa")]
        const variable = row[headers.indexOf("Variável")]
        const surveyName = row[headers.indexOf("Arquivo do BD")]
        const questionText = row[headers.indexOf("Texto da Pergunta")]
        const label = row[headers.indexOf("Rótulo")]
        const index = row[headers.indexOf("Index")]
        const methodology = row[headers.indexOf("Metodologia")]
        const map = row[headers.indexOf("Mapa")]
        const sample = row[headers.indexOf("Amostra")]
        const date = row[headers.indexOf("Data")]

        if (!surveyNumber || !variable) {
          return null
        }

        return {
          updateOne: {
            filter: {
              surveyNumber: surveyNumber.toString(),
              variable: variable.trim(),
            },
            update: {
              $set: {
                surveyNumber: surveyNumber.toString(),
                surveyName: surveyName || "",
                variable: variable.trim(),
                questionText: questionText || "",
                label: label || "",
                index: index || "",
                methodology: methodology || "",
                map: map || "",
                sample: sample || "",
                date: date || "",
              },
            },
            upsert: true, // Cria se não existir, atualiza se existir
          },
        }
      })
      .filter(Boolean)

    if (operations.length === 0) {
      return res.status(200).json({ message: "Nenhum dado válido para processar." })
    }

    console.log(`Executando ${operations.length} operações em lote...`)
    const result = await QuestionIndex.bulkWrite(operations, { ordered: false })

    console.log("Atualização de variáveis concluída.")
    res.status(200).json({
      message: "Variáveis atualizadas com sucesso!",
      upsertedCount: result.upsertedCount,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
      totalProcessed: operations.length,
      insertedCount: result.insertedCount || 0,
    })
  } catch (error) {
    console.error("Erro ao atualizar variáveis:", error)
    res.status(500).json({ error: "Erro interno no servidor.", details: error.message })
  }
})

// POST /api/migration/sync-surveys
// Migra dados do Google Drive, distribuindo entre os bancos de dados por ano
router.get("/sync-surveys", ensureServiceInitialized, async (req, res) => {
  try {
    console.log("Iniciando migração de dados de pesquisas com distribuição por ano...")

    const allFilesByYear = await driveService.listAllSurveyFiles()
    let totalFilesProcessed = 0
    let totalResponsesMigrated = 0

    const yearsToProcess = ["2023", "2024", "2025"] // Anos que queremos processar

    for (const year of yearsToProcess) {
      if (!allFilesByYear.years[year]) {
        console.log(`- Ano ${year} não encontrado nos arquivos. Pulando.`)
        continue
      }

      const yearData = allFilesByYear.years[year]
      console.log(`Processando ano: ${year} (${yearData.files.length} arquivos)`)

      // Seleciona os modelos corretos para o ano
      const Survey = await getModel("Survey")
      const Response = await getModel("Response")

      for (const file of yearData.files) {
        const fileHash = `${file.id}-${file.modifiedTime}`
        const existingSurvey = await Survey.findOne({ fileHashes: fileHash })
        if (existingSurvey) {
          console.log(`  - Arquivo ${file.name} já processado. Pulando.`)
          continue
        }

        console.log(`  + Processando arquivo: ${file.name}`)
        const fileData = await driveService.readGoogleSheetsFile(file.id)

        for (const sheetName of Object.keys(fileData.sheets)) {
          const sheetData = fileData.sheets[sheetName]
          if (!sheetData || sheetData.length < 2) continue

          const headers = sheetData[0].map((h) => (h ? h.toString().toUpperCase() : ""))
          const dataRows = sheetData.slice(1)

          if (headers.length === 0 || dataRows.length === 0) continue

          const surveyName = `${file.name} - ${sheetName}`
          const survey = await Survey.findOneAndUpdate(
            { name: surveyName },
            { $set: { year: year, month: file.rodada } },
            { upsert: true, new: true },
          )

          const responses = dataRows.map((row, index) => {
            const entrevistadoId = row[0] || `resp_${index + 1}`
            const answers = headers
              .map((key, index) => {
                const value = row[index]
                if (!key || value === null || value === undefined || value === "") return null
                return { k: key, v: value }
              })
              .filter(Boolean)

            return {
              surveyId: survey._id,
              entrevistadoId: entrevistadoId.toString(),
              answers,
              rodada: file.rodada,
              year: Number.parseInt(year, 10),
            }
          })

          if (responses.length > 0) {
            await Response.insertMany(responses, { ordered: false, lean: true })
            totalResponsesMigrated += responses.length
          }

          await Survey.updateOne({ _id: survey._id }, { $addToSet: { fileHashes: fileHash } })
        }
        totalFilesProcessed++
      }
    }

    const message = "Migração distribuída concluída com sucesso!"
    console.log(message)
    res.status(200).json({
      message,
      filesProcessed: totalFilesProcessed,
      responsesMigrated: totalResponsesMigrated,
    })
  } catch (error) {
    console.error("Erro durante a migração distribuída:", error)
    res.status(500).json({ error: "Erro interno no servidor durante a migração.", details: error.message })
  }
})

module.exports = router
