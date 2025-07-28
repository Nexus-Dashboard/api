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
// Sincroniza o índice de perguntas para o banco de dados TELEFONICO
router.get("/sync-index", ensureServiceInitialized, async (req, res) => {
  try {
    const QuestionIndex = await getModel("QuestionIndex", "telephonic")
    const indexFileId = "1FurphB54po2Pu-ganTcYqHTMZ7leHuWl_g9hodmhAco"
    console.log(`Iniciando sincronização do índice de perguntas para o banco [telephonic]...`)

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
    console.log("Sincronização do índice [telephonic] concluída.")
    res.status(200).json({ message: "Índice de perguntas [telephonic] sincronizado com sucesso!", ...result })
  } catch (error) {
    console.error("Erro ao sincronizar índice de perguntas:", error)
    res.status(500).json({ error: "Erro interno no servidor.", details: error.message })
  }
})

// NOVO: Rota para sincronizar o índice de perguntas F2F
// GET /api/migration/sync-f2f-index
router.get("/sync-f2f-index", ensureServiceInitialized, async (req, res) => {
  try {
    // Conecta ao banco de dados secundário (f2f)
    const QuestionIndex = await getModel("QuestionIndex", "f2f")
    const indexFileId = "1pcJqXSzEzqNYWMdThadgmt3FDib5V5gzZz2DSeXg1AU"
    console.log(`Iniciando sincronização do índice de perguntas para o banco [f2f]...`)

    const fileData = await driveService.readGoogleSheetsFile(indexFileId)
    // Assumindo que a aba principal se chama 'base' ou a primeira aba
    const sheetName = fileData.sheetNames[0]
    const sheet = fileData.sheets[sheetName]

    if (!sheet || sheet.length < 2) {
      return res.status(400).json({ error: `Planilha de índice F2F (aba '${sheetName}') não encontrada ou vazia.` })
    }

    const headers = sheet[0].map((h) => (h ? h.trim() : ""))
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
        if (!doc.variable || !doc.surveyNumber) return null
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
      return res.status(200).json({ message: "Nenhum dado válido para sincronizar no índice F2F." })
    }

    const result = await QuestionIndex.bulkWrite(operations)
    console.log("Sincronização do índice [f2f] concluída.")
    res.status(200).json({ message: "Índice de perguntas [f2f] sincronizado com sucesso!", ...result })
  } catch (error) {
    console.error("Erro ao sincronizar índice de perguntas F2F:", error)
    res.status(500).json({ error: "Erro interno no servidor.", details: error.message })
  }
})

// POST /api/migration/sync-index-answers
// Sincroniza as respostas possíveis do dicionário para o índice de perguntas TELEFONICO
router.get("/sync-index-answers", ensureServiceInitialized, async (req, res) => {
  try {
    console.log("Iniciando sincronização de respostas para o índice [telephonic]...")

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
    const QuestionIndex = await getModel("QuestionIndex", "telephonic")
    console.log("Buscando todas as perguntas do índice [telephonic]...")
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
        if (possibleAnswers.length > 0 && (!question.possibleAnswers || question.possibleAnswers.length === 0)) {
          return {
            updateOne: {
              filter: { _id: question._id },
              update: { $set: { possibleAnswers: possibleAnswers } },
            },
          }
        }
        return null // Não faz nada se não encontrou respostas ou se já tinha
      })
      .filter(Boolean)

    if (operations.length === 0) {
      return res.status(200).json({
        message: "Nenhuma pergunta nova para atualizar com respostas. A sincronização pode já estar completa.",
        updatedCount: 0,
      })
    }

    // 4. Execute bulk write
    console.log(`Preparando para atualizar ${operations.length} documentos com novas respostas...`)
    const result = await QuestionIndex.bulkWrite(operations)
    console.log("Sincronização de respostas do índice [telephonic] concluída.")
    res.status(200).json({
      message: "Respostas do índice [telephonic] sincronizadas com sucesso!",
      updatedCount: result.modifiedCount,
    })
  } catch (error) {
    console.error("Erro ao sincronizar respostas do índice:", error)
    res.status(500).json({ error: "Erro interno no servidor.", details: error.message })
  }
})

// POST /api/migration/update-variables
// Atualiza o campo variable no QuestionIndex TELEFONICO com os valores da planilha
router.get("/update-variables", ensureServiceInitialized, async (req, res) => {
  try {
    console.log("Iniciando atualização de variáveis no índice [telephonic]...")

    const QuestionIndex = await getModel("QuestionIndex", "telephonic")
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

    console.log("Atualização de variáveis [telephonic] concluída.")
    res.status(200).json({
      message: "Variáveis [telephonic] atualizadas com sucesso!",
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
// Migra dados TELEFONICOS do Google Drive para o banco principal
router.get("/sync-surveys", ensureServiceInitialized, async (req, res) => {
  try {
    console.log("Iniciando migração de dados de pesquisas [telephonic]...")

    const allFilesByYear = await driveService.listAllSurveyFiles()
    let totalFilesProcessed = 0
    let totalResponsesMigrated = 0

    const yearsToProcess = Object.keys(allFilesByYear.years)

    for (const year of yearsToProcess) {
      const yearData = allFilesByYear.years[year]
      console.log(`Processando ano: ${year} (${yearData.files.length} arquivos)`)

      // Seleciona os modelos do banco principal
      const Survey = await getModel("Survey", "telephonic")
      const Response = await getModel("Response", "telephonic")

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

    const message = "Migração [telephonic] concluída com sucesso!"
    console.log(message)
    res.status(200).json({
      message,
      filesProcessed: totalFilesProcessed,
      responsesMigrated: totalResponsesMigrated,
    })
  } catch (error) {
    console.error("Erro durante a migração [telephonic]:", error)
    res.status(500).json({ error: "Erro interno no servidor durante a migração.", details: error.message })
  }
})

// NOVO: Rota para migrar dados F2F para o banco secundário COM FILTROS DE TAMANHO
// GET /api/migration/sync-f2f-surveys?skipLargeFiles=true&maxResponses=15000&skipRounds=03,06,08,09
router.get("/sync-f2f-surveys", ensureServiceInitialized, async (req, res) => {
  try {
    const { skipLargeFiles = "true", maxResponses = "15000", skipRounds = "03,06,08,09", dryRun = "false" } = req.query

    console.log("🔍 Iniciando migração de dados de pesquisas [f2f] com filtros...")
    console.log(`📊 Configurações:`)
    console.log(`   - Pular arquivos grandes: ${skipLargeFiles}`)
    console.log(`   - Máximo de respostas por arquivo: ${maxResponses}`)
    console.log(`   - Rodadas a pular: ${skipRounds}`)
    console.log(`   - Modo simulação: ${dryRun}`)

    const allFilesByYear = await driveService.listAllF2FSurveyFiles()
    let totalFilesProcessed = 0
    let totalFilesSkipped = 0
    let totalResponsesMigrated = 0
    const skippedFiles = []

    const yearsToProcess = Object.keys(allFilesByYear.years)
    const roundsToSkip = skipRounds ? skipRounds.split(",").map((r) => r.trim().padStart(2, "0")) : []
    const maxResponsesLimit = Number.parseInt(maxResponses)

    console.log(`🚫 Rodadas que serão puladas: ${roundsToSkip.join(", ")}`)

    for (const year of yearsToProcess) {
      const yearData = allFilesByYear.years[year]
      console.log(`📅 Processando ano F2F: ${year} (${yearData.files.length} arquivos)`)

      // Seleciona os modelos do banco secundário (f2f)
      const Survey = await getModel("Survey", "f2f")
      const Response = await getModel("Response", "f2f")

      for (const file of yearData.files) {
        const rodadaNumber = file.rodada ? file.rodada.toString().padStart(2, "0") : null
        try {
          // Verificar se deve pular por rodada
          if (rodadaNumber && roundsToSkip.includes(rodadaNumber)) {
            console.log(`🚫 Pulando arquivo por rodada restrita: ${file.name} (Rodada ${rodadaNumber})`)
            totalFilesSkipped++
            skippedFiles.push({
              name: file.name,
              reason: `Rodada ${rodadaNumber} está na lista de exclusão`,
              year: year,
              rodada: rodadaNumber,
            })
            continue
          }

          const fileHash = `${file.id}-${file.modifiedTime}`
          const existingSurvey = await Survey.findOne({ fileHashes: fileHash })
          if (existingSurvey) {
            console.log(`✅ Arquivo F2F ${file.name} já processado. Pulando.`)
            continue
          }

          console.log(`🔍 Analisando arquivo F2F: ${file.name}`)

          // Ler o arquivo para verificar o tamanho
          const fileData = await driveService.readGoogleSheetsFile(file.id)

          // Contar total de linhas em todas as abas
          let totalRows = 0
          for (const sheetName of Object.keys(fileData.sheets)) {
            const sheetData = fileData.sheets[sheetName]
            if (sheetData && sheetData.length > 1) {
              // -1 para descontar o header
              totalRows += sheetData.length - 1
            }
          }

          // Verificar se deve pular por tamanho
          if (skipLargeFiles === "true" && totalRows > maxResponsesLimit) {
            console.log(`🚫 Pulando arquivo muito grande: ${file.name}`)
            console.log(`   📊 Respostas encontradas: ${totalRows.toLocaleString()}`)
            console.log(`   📊 Limite configurado: ${maxResponsesLimit.toLocaleString()}`)

            totalFilesSkipped++
            skippedFiles.push({
              name: file.name,
              reason: `Arquivo muito grande (${totalRows.toLocaleString()} respostas > ${maxResponsesLimit.toLocaleString()})`,
              year: year,
              rodada: rodadaNumber,
              totalRows: totalRows,
            })
            continue
          }

          // Se chegou até aqui, o arquivo será processado
          console.log(`✅ Arquivo aprovado para migração: ${file.name}`)
          console.log(`   📊 Total de respostas: ${totalRows.toLocaleString()}`)

          // Se for dry run, apenas simular
          if (dryRun === "true") {
            console.log(`🔄 [SIMULAÇÃO] Processaria arquivo: ${file.name}`)
            totalFilesProcessed++
            totalResponsesMigrated += totalRows
            continue
          }

          // Processar o arquivo normalmente
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
              // Inserir em lotes menores para evitar problemas de memória
              const batchSize = 1000
              for (let i = 0; i < responses.length; i += batchSize) {
                const batch = responses.slice(i, i + batchSize)
                await Response.insertMany(batch, { ordered: false, lean: true })
                console.log(`   📝 Inserido lote ${Math.floor(i / batchSize) + 1}: ${batch.length} respostas`)
              }
              totalResponsesMigrated += responses.length
            }

            await Survey.updateOne({ _id: survey._id }, { $addToSet: { fileHashes: fileHash } })
          }

          totalFilesProcessed++
          console.log(`✅ Arquivo processado com sucesso: ${file.name}`)
        } catch (fileError) {
          console.error(`❌ Erro ao processar arquivo ${file.name}:`, fileError.message)

          // Se for erro de quota, parar a migração
          if (fileError.message.includes("space quota") || fileError.message.includes("AtlasError")) {
            console.error(`🚫 ERRO DE QUOTA DETECTADO! Parando migração para evitar mais problemas.`)

            return res.status(507).json({
              success: false,
              error: "Quota de espaço excedida durante a migração",
              message: "Migração interrompida para evitar mais problemas de espaço",
              progress: {
                filesProcessed: totalFilesProcessed,
                filesSkipped: totalFilesSkipped,
                responsesMigrated: totalResponsesMigrated,
                lastProcessedFile: file.name,
              },
              skippedFiles: skippedFiles,
              recommendation: "Considere aumentar o limite de espaço ou pular mais arquivos grandes",
            })
          }

          totalFilesSkipped++
          skippedFiles.push({
            name: file.name,
            reason: `Erro durante processamento: ${fileError.message}`,
            year: year,
            rodada: rodadaNumber,
          })
        }
      }
    }

    const message =
      dryRun === "true" ? "Simulação de migração [f2f] concluída!" : "Migração [f2f] concluída com sucesso!"

    console.log(message)
    console.log(`📊 Estatísticas finais:`)
    console.log(`   ✅ Arquivos processados: ${totalFilesProcessed}`)
    console.log(`   🚫 Arquivos pulados: ${totalFilesSkipped}`)
    console.log(`   📝 Respostas migradas: ${totalResponsesMigrated.toLocaleString()}`)

    res.status(200).json({
      success: true,
      message,
      isDryRun: dryRun === "true",
      statistics: {
        filesProcessed: totalFilesProcessed,
        filesSkipped: totalFilesSkipped,
        responsesMigrated: totalResponsesMigrated,
        totalFilesAnalyzed: totalFilesProcessed + totalFilesSkipped,
      },
      skippedFiles: skippedFiles,
      filters: {
        skipLargeFiles: skipLargeFiles === "true",
        maxResponses: maxResponsesLimit,
        skippedRounds: roundsToSkip,
      },
      recommendations:
        skippedFiles.length > 0
          ? [
              "Considere processar arquivos grandes em um banco com mais espaço",
              "Use parâmetros mais restritivos se necessário",
              "Monitore o uso de espaço durante a migração",
            ]
          : [],
    })
  } catch (error) {
    console.error("❌ Erro durante a migração [f2f]:", error)
    res.status(500).json({
      success: false,
      error: "Erro interno no servidor durante a migração.",
      details: error.message,
    })
  }
})

// NOVO: Rota para analisar arquivos F2F antes da migração
// GET /api/migration/analyze-f2f-files?maxResponses=15000
router.get("/analyze-f2f-files", ensureServiceInitialized, async (req, res) => {
  try {
    const { maxResponses = "15000" } = req.query
    const maxResponsesLimit = Number.parseInt(maxResponses)

    console.log("🔍 Analisando arquivos F2F para migração...")
    console.log(`📊 Limite de respostas: ${maxResponsesLimit.toLocaleString()}`)

    const allFilesByYear = await driveService.listAllF2FSurveyFiles()
    const analysis = {
      totalFiles: 0,
      smallFiles: [],
      largeFiles: [],
      errorFiles: [],
      summary: {
        totalSmallFiles: 0,
        totalLargeFiles: 0,
        totalErrorFiles: 0,
        estimatedSmallResponses: 0,
        estimatedLargeResponses: 0,
      },
    }

    for (const year of Object.keys(allFilesByYear.years)) {
      const yearData = allFilesByYear.years[year]
      console.log(`📅 Analisando ano: ${year} (${yearData.files.length} arquivos)`)

      for (const file of yearData.files) {
        analysis.totalFiles++

        try {
          console.log(`🔍 Analisando: ${file.name}`)

          const fileData = await driveService.readGoogleSheetsFile(file.id)

          let totalRows = 0
          const sheetDetails = {}

          for (const sheetName of Object.keys(fileData.sheets)) {
            const sheetData = fileData.sheets[sheetName]
            if (sheetData && sheetData.length > 1) {
              const rows = sheetData.length - 1 // -1 para descontar header
              totalRows += rows
              sheetDetails[sheetName] = rows
            }
          }

          const fileInfo = {
            name: file.name,
            year: year,
            rodada: file.rodada,
            totalResponses: totalRows,
            sheets: sheetDetails,
            size: totalRows > maxResponsesLimit ? "LARGE" : "SMALL",
          }

          if (totalRows > maxResponsesLimit) {
            analysis.largeFiles.push(fileInfo)
            analysis.summary.totalLargeFiles++
            analysis.summary.estimatedLargeResponses += totalRows
          } else {
            analysis.smallFiles.push(fileInfo)
            analysis.summary.totalSmallFiles++
            analysis.summary.estimatedSmallResponses += totalRows
          }

          console.log(`   📊 ${totalRows.toLocaleString()} respostas - ${fileInfo.size}`)
        } catch (error) {
          console.error(`❌ Erro ao analisar ${file.name}:`, error.message)

          analysis.errorFiles.push({
            name: file.name,
            year: year,
            rodada: file.rodada,
            error: error.message,
          })
          analysis.summary.totalErrorFiles++
        }
      }
    }

    // Ordenar por tamanho
    analysis.largeFiles.sort((a, b) => b.totalResponses - a.totalResponses)
    analysis.smallFiles.sort((a, b) => b.totalResponses - a.totalResponses)

    console.log(`✅ Análise concluída:`)
    console.log(`   📁 Total de arquivos: ${analysis.totalFiles}`)
    console.log(`   ✅ Arquivos pequenos: ${analysis.summary.totalSmallFiles}`)
    console.log(`   🚫 Arquivos grandes: ${analysis.summary.totalLargeFiles}`)
    console.log(`   ❌ Arquivos com erro: ${analysis.summary.totalErrorFiles}`)

    res.json({
      success: true,
      analysis: analysis,
      recommendations: {
        message: `Encontrados ${analysis.summary.totalLargeFiles} arquivos grandes que devem ser pulados`,
        suggestedCommand: `/api/migration/sync-f2f-surveys?skipLargeFiles=true&maxResponses=${maxResponses}`,
        largeFilesRounds: [...new Set(analysis.largeFiles.map((f) => f.rodada))].filter(Boolean),
        estimatedMigrationSize: `${analysis.summary.estimatedSmallResponses.toLocaleString()} respostas`,
      },
    })
  } catch (error) {
    console.error("❌ Erro durante análise:", error)
    res.status(500).json({
      success: false,
      error: "Erro ao analisar arquivos F2F",
      details: error.message,
    })
  }
})

module.exports = router
