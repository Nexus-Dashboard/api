// routes/googleRoutes.js
const express = require("express")
const router = express.Router()
const GoogleDriveService = require("../services/googleDriveService")

// Instância do serviço
const driveService = new GoogleDriveService()
let serviceInitialized = false

// Middleware para garantir que o serviço esteja inicializado
const ensureServiceInitialized = async (req, res, next) => {
  try {
    if (!serviceInitialized) {
      await driveService.initialize()
      serviceInitialized = true
    }
    next()
  } catch (error) {
    console.error("Erro ao inicializar serviço Google:", error)
    res.status(500).json({
      error: "Erro ao conectar com Google Drive",
      details: error.message,
    })
  }
}

// GET /api/google/years
// Lista todas as pastas de anos disponíveis
router.get("/years", ensureServiceInitialized, async (req, res) => {
  try {
    const yearFolders = await driveService.listYearFolders()
    res.json({
      success: true,
      totalYears: yearFolders.length,
      years: yearFolders,
    })
  } catch (error) {
    console.error("Erro ao listar anos:", error)
    res.status(500).json({
      error: "Erro ao listar anos disponíveis",
      details: error.message,
    })
  }
})

// GET /api/google/surveys
// Lista todos os arquivos de pesquisa organizados por ano
router.get("/surveys", ensureServiceInitialized, async (req, res) => {
  try {
    const allSurveys = await driveService.listAllSurveyFiles()
    res.json({
      success: true,
      data: allSurveys,
    })
  } catch (error) {
    console.error("Erro ao listar pesquisas:", error)
    res.status(500).json({
      error: "Erro ao listar arquivos de pesquisa",
      details: error.message,
    })
  }
})

// GET /api/google/surveys/:year
// Lista arquivos de pesquisa de um ano específico
router.get("/surveys/:year", ensureServiceInitialized, async (req, res) => {
  try {
    const { year } = req.params
    const yearFolders = await driveService.listYearFolders()
    const yearFolder = yearFolders.find((folder) => folder.name === year)

    if (!yearFolder) {
      return res.status(404).json({
        error: `Ano ${year} não encontrado`,
      })
    }

    const surveyFiles = await driveService.listSurveyFilesInYear(yearFolder.id)
    res.json({
      success: true,
      year: year,
      totalFiles: surveyFiles.length,
      files: surveyFiles,
    })
  } catch (error) {
    console.error("Erro ao listar pesquisas do ano:", error)
    res.status(500).json({
      error: "Erro ao listar pesquisas do ano",
      details: error.message,
    })
  }
})

// GET /api/google/question/:questionCode
// Busca dados históricos de uma pergunta específica
router.get("/question/:questionCode", ensureServiceInitialized, async (req, res) => {
  try {
    const { questionCode } = req.params
    const { format } = req.query

    console.log(`Buscando dados históricos para pergunta: ${questionCode}`)

    if (format === "aggregated") {
      const aggregatedData = await driveService.getQuestionAggregatedData(questionCode)
      res.json({
        success: true,
        data: aggregatedData,
      })
    } else {
      const historicalData = await driveService.getQuestionHistoricalData(questionCode)
      res.json({
        success: true,
        data: historicalData,
      })
    }
  } catch (error) {
    console.error("Erro ao buscar dados da pergunta:", error)
    res.status(500).json({
      error: "Erro ao buscar dados da pergunta",
      details: error.message,
    })
  }
})

// GET /api/google/question/:questionCode/year/:year
// Busca dados de uma pergunta específica em um ano específico
router.get("/question/:questionCode/year/:year", ensureServiceInitialized, async (req, res) => {
  try {
    const { questionCode, year } = req.params

    const historicalData = await driveService.getQuestionHistoricalData(questionCode)

    if (!historicalData.years[year]) {
      return res.status(404).json({
        error: `Dados da pergunta ${questionCode} não encontrados para o ano ${year}`,
      })
    }

    res.json({
      success: true,
      questionCode: questionCode,
      year: year,
      data: historicalData.years[year],
    })
  } catch (error) {
    console.error("Erro ao buscar dados da pergunta por ano:", error)
    res.status(500).json({
      error: "Erro ao buscar dados da pergunta por ano",
      details: error.message,
    })
  }
})

// GET /api/google/file/:fileId
// Lê conteúdo de um arquivo específico
router.get("/file/:fileId", ensureServiceInitialized, async (req, res) => {
  try {
    const { fileId } = req.params
    const { sheet } = req.query

    const fileData = await driveService.readGoogleSheetsFile(fileId)

    if (sheet && fileData.sheets[sheet]) {
      res.json({
        success: true,
        fileId: fileId,
        fileName: fileData.fileName,
        sheet: sheet,
        data: fileData.sheets[sheet],
      })
    } else {
      res.json({
        success: true,
        fileData: fileData,
      })
    }
  } catch (error) {
    console.error("Erro ao ler arquivo:", error)
    res.status(500).json({
      error: "Erro ao ler arquivo",
      details: error.message,
    })
  }
})

// GET /api/google/questions/available
// Lista todas as perguntas disponíveis nos arquivos
router.get("/questions/available", ensureServiceInitialized, async (req, res) => {
  try {
    const allSurveys = await driveService.listAllSurveyFiles()
    const availableQuestions = new Set()

    // Processar alguns arquivos para descobrir quais perguntas estão disponíveis
    for (const [year, yearData] of Object.entries(allSurveys.years)) {
      if (yearData.files.length > 0) {
        // Pegar o primeiro arquivo de cada ano como amostra
        const sampleFile = yearData.files[0]
        try {
          const fileData = await driveService.readGoogleSheetsFile(sampleFile.id)

          // Verificar headers de todas as sheets
          for (const [sheetName, sheetData] of Object.entries(fileData.sheets)) {
            if (sheetData.length > 0) {
              const headers = sheetData[0]
              headers.forEach((header) => {
                if (header && typeof header === "string" && header.match(/^P\d+/i)) {
                  availableQuestions.add(header.toUpperCase())
                }
              })
            }
          }
        } catch (error) {
          console.error(`Erro ao processar arquivo ${sampleFile.name}:`, error.message)
        }
      }
    }

    res.json({
      success: true,
      totalQuestions: availableQuestions.size,
      questions: Array.from(availableQuestions).sort(),
    })
  } catch (error) {
    console.error("Erro ao listar perguntas disponíveis:", error)
    res.status(500).json({
      error: "Erro ao listar perguntas disponíveis",
      details: error.message,
    })
  }
})

// GET /api/google/cache/status
// Verifica status do cache
router.get("/cache/status", ensureServiceInitialized, async (req, res) => {
  try {
    const cacheStatus = {
      isValid: driveService._isCacheValid(),
      lastUpdate: driveService.cache.lastUpdate,
      cacheDuration: driveService.CACHE_DURATION,
      cachedItems: {
        yearFolders: !!driveService.cache.yearFolders,
        allSurveyFiles: !!driveService.cache.allSurveyFiles,
        fileDataCount: driveService.cache.fileData.size,
        questionDataCount: driveService.cache.questionData.size,
      },
    }

    res.json({
      success: true,
      cache: cacheStatus,
    })
  } catch (error) {
    console.error("Erro ao verificar status do cache:", error)
    res.status(500).json({
      error: "Erro ao verificar status do cache",
      details: error.message,
    })
  }
})

// DELETE /api/google/cache
// Limpa o cache
router.delete("/cache", ensureServiceInitialized, async (req, res) => {
  try {
    driveService.clearCache()
    res.json({
      success: true,
      message: "Cache limpo com sucesso",
    })
  } catch (error) {
    console.error("Erro ao limpar cache:", error)
    res.status(500).json({
      error: "Erro ao limpar cache",
      details: error.message,
    })
  }
})

// GET /api/google/question/:questionCode/quick
// Versão rápida que retorna dados básicos primeiro
router.get("/question/:questionCode/quick", ensureServiceInitialized, async (req, res) => {
  try {
    const { questionCode } = req.params

    console.log(`⚡ Busca rápida para pergunta: ${questionCode}`)

    // Primeiro, retorna informações básicas
    const allFiles = await driveService.listAllSurveyFiles()

    const quickResponse = {
      questionCode: questionCode,
      availableYears: Object.keys(allFiles.years),
      totalFiles: Object.values(allFiles.years).reduce((sum, year) => sum + year.totalFiles, 0),
      status: "processing",
      message: "Dados básicos carregados. Processamento completo em andamento...",
    }

    res.json({
      success: true,
      data: quickResponse,
    })
  } catch (error) {
    console.error("Erro na busca rápida:", error)
    res.status(500).json({
      error: "Erro na busca rápida",
      details: error.message,
    })
  }
})

module.exports = router
