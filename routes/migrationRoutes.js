// routes/migrationRoutes.js
const express = require("express")
const router = express.Router()
const GoogleDriveService = require("../services/googleDriveService")
const { getModel } = require("../config/dbManager")

const driveService = new GoogleDriveService()
let serviceInitialized = false

const ensureServiceInitialized = async (req, res, next) => {
  if (serviceInitialized) return next()
  try {
    await driveService.initialize()
    serviceInitialized = true
    next()
  } catch (error) {
    console.error("Erro ao inicializar serviço Google:", error)
    res.status(500).json({ error: "Erro ao conectar com Google Drive", details: error.message })
  }
}

// POST /api/migration/sync-index
// Sincroniza o índice de perguntas para o banco de dados PRINCIPAL
router.post("/sync-index", ensureServiceInitialized, async (req, res) => {
  try {
    const QuestionIndex = getModel("QuestionIndex", "main") // Sempre no principal
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

// POST /api/migration/sync-surveys
// Migra dados do Google Drive, distribuindo entre os bancos de dados por ano
router.post("/sync-surveys", ensureServiceInitialized, async (req, res) => {
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
      console.log(
        `Processando ano: ${year} (${yearData.files.length} arquivos) -> Banco: ${year === "2025" ? "2025" : "main"}`,
      )

      // Seleciona os modelos corretos para o ano
      const Survey = getModel("Survey", year)
      const Response = getModel("Response", year)

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
