// routes/dataRoutes.js
const express = require("express")
const router = express.Router()
const { getModel, getAllModels } = require("../config/dbManager")

// Função para criar slug normalizado
function createSlug(text) {
  if (!text || typeof text !== "string") return ""
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove acentos
    .replace(/[^a-z0-9\s-]/g, "") // Remove caracteres especiais
    .replace(/\s+/g, "-") // Substitui espaços por hífens
    .replace(/-+/g, "-") // Remove hífens do início/fim
}

// GET /api/data/themes
router.get("/themes", async (req, res) => {
  try {
    console.log("🎯 Buscando temas disponíveis...")

    const QuestionIndex = await getModel("QuestionIndex")

    const themes = await QuestionIndex.aggregate([
      {
        $match: {
          index: { $exists: true, $ne: null, $ne: "" },
        },
      },
      {
        $group: {
          _id: "$index",
          questionCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          theme: "$_id",
          questionCount: 1,
        },
      },
      {
        $sort: { theme: 1 },
      },
    ])

    // Adicionar slug após a agregação
    const themesWithSlug = themes.map((theme) => ({
      ...theme,
      slug: createSlug(theme.theme),
      id: createSlug(theme.theme), // Para compatibilidade
    }))

    console.log(`✅ Encontrados ${themesWithSlug.length} temas`)

    res.json({
      success: true,
      count: themesWithSlug.length,
      themes: themesWithSlug,
    })
  } catch (error) {
    console.error("❌ Erro ao buscar temas:", error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
})

// Adicionar esta nova rota após a rota GET /api/data/themes

// GET /api/data/questions/all
// Retorna todas as perguntas do índice com paginação opcional
router.get("/questions/all", async (req, res) => {
  try {
    const { page = 1, limit = 50, search, index: themeFilter } = req.query

    console.log("🎯 Buscando todas as perguntas do índice...")

    const QuestionIndex = await getModel("QuestionIndex")

    // Construir filtros
    const filters = {}
    if (search) {
      filters.$or = [
        { variable: { $regex: search, $options: "i" } },
        { questionText: { $regex: search, $options: "i" } },
        { label: { $regex: search, $options: "i" } },
        { surveyName: { $regex: search, $options: "i" } },
      ]
    }
    if (themeFilter) {
      filters.index = themeFilter
    }

    // Paginação
    const skip = (page - 1) * limit
    const total = await QuestionIndex.countDocuments(filters)

    const questions = await QuestionIndex.find(filters)
      .sort({ surveyNumber: 1, variable: 1 })
      .skip(skip)
      .limit(Number.parseInt(limit))
      .lean()

    console.log(`✅ Encontradas ${questions.length} perguntas (total: ${total})`)

    res.json({
      success: true,
      data: {
        questions: questions,
        pagination: {
          currentPage: Number.parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalQuestions: total,
          hasNext: skip + questions.length < total,
          hasPrev: page > 1,
          limit: Number.parseInt(limit),
        },
      },
    })
  } catch (error) {
    console.error("❌ Erro ao buscar todas as perguntas:", error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
})

// GET /api/data/themes/:themeSlug/questions
router.get("/themes/:themeSlug/questions", async (req, res) => {
  try {
    const { themeSlug } = req.params
    console.log(`🎯 Buscando perguntas do tema com slug: ${themeSlug}`)

    const QuestionIndex = await getModel("QuestionIndex")

    // Primeiro, encontrar o tema real pelo slug
    const allThemes = await QuestionIndex.aggregate([
      {
        $match: {
          index: { $exists: true, $ne: null, $ne: "" },
        },
      },
      {
        $group: {
          _id: "$index",
        },
      },
    ])

    // Encontrar o tema que corresponde ao slug
    const targetTheme = allThemes.find((theme) => createSlug(theme._id) === themeSlug)

    if (!targetTheme) {
      return res.status(404).json({
        success: false,
        message: `Tema com slug '${themeSlug}' não encontrado`,
      })
    }

    const themeName = targetTheme._id

    const questions = await QuestionIndex.find({
      index: themeName,
    })
      .select("variable questionText label surveyNumber surveyName")
      .sort({ variable: 1 })
      .lean()

    console.log(`✅ Encontradas ${questions.length} perguntas para o tema '${themeName}'`)

    res.json({
      success: true,
      theme: themeName,
      slug: themeSlug,
      count: questions.length,
      questions: questions,
    })
  } catch (error) {
    console.error(`❌ Erro ao buscar perguntas do tema ${req.params.themeSlug}:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
})

// GET /api/data/question/:questionCode/responses - VERSÃO OTIMIZADA COM TODOS OS CAMPOS DEMOGRÁFICOS
router.get("/question/:questionCode/responses", async (req, res) => {
  try {
    const { questionCode } = req.params
    const questionCodeUpper = questionCode.toUpperCase()

    console.log(`⚡️ Executando busca OTIMIZADA com TODOS os campos demográficos para ${questionCodeUpper}`)

    const QuestionIndex = await getModel("QuestionIndex")
    const questionInfo = await QuestionIndex.findOne({
      variable: questionCodeUpper,
    }).lean()

    if (!questionInfo) {
      return res.status(404).json({
        success: false,
        message: `Pergunta '${questionCode}' não encontrada no índice.`,
      })
    }

    const identicalQuestions = await QuestionIndex.find({
      questionText: questionInfo.questionText,
      variable: { $exists: true, $ne: null, $ne: "" },
    }).lean()

    const questionCodes = identicalQuestions.map((q) => q.variable.toUpperCase())
    console.log(`📋 Perguntas com texto idêntico: ${questionCodes.join(", ")}`)

    const responseModels = await getAllModels("Response")
    const rawData = []

    // TODOS os campos demográficos: originais + UF + REGIAO
    const demographicFields = [
      "UF",
      "Regiao",
      "PF1",
      "PF2#1",
      "PF2_faixas",
      "PF3",
      "PF4",
      "PF5",
      "PF6",
      "PF7",
      "PF8",
      "PF9",
    ]

    // 1. Fetch all raw data in one go from all DBs
    for (const Response of responseModels) {
      console.log(`🔍 Processando banco: ${Response.db.name}`)

      const pipeline = [
        { $match: { "answers.k": { $in: questionCodes } } },
        {
          $project: {
            _id: 0,
            year: 1,
            rodada: 1,
            mainAnswer: {
              $let: {
                vars: {
                  ans: {
                    $filter: {
                      input: "$answers",
                      cond: { $in: ["$$this.k", questionCodes] },
                    },
                  },
                },
                in: { $arrayElemAt: ["$$ans.v", 0] },
              },
            },
            weight: {
              $let: {
                vars: {
                  weightAns: {
                    $filter: {
                      input: "$answers",
                      cond: { $regexMatch: { input: "$$this.k", regex: /weights/i } },
                    },
                  },
                },
                in: {
                  $ifNull: [
                    {
                      $toDouble: {
                        $replaceAll: {
                          input: { $toString: { $arrayElemAt: ["$$weightAns.v", 0] } },
                          find: ",",
                          replacement: ".",
                        },
                      },
                    },
                    1.0,
                  ],
                },
              },
            },
            demographics: {
              $arrayToObject: {
                $map: {
                  input: {
                    $filter: {
                      input: "$answers",
                      cond: { $in: ["$$this.k", demographicFields] },
                    },
                  },
                  as: "item",
                  in: { k: "$$item.k", v: "$$item.v" },
                },
              },
            },
          },
        },
        { $match: { mainAnswer: { $exists: true, $ne: null, $ne: "" } } },
      ]

      const results = await Response.aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 120000 })
      rawData.push(...results)
    }

    console.log(`📊 Total de registros brutos coletados: ${rawData.length}`)

    // 2. Process raw data in memory
    const processedData = new Map()

    for (const doc of rawData) {
      const roundKey = `${doc.year}-R${doc.rodada}`
      if (!processedData.has(roundKey)) {
        processedData.set(roundKey, {
          year: doc.year,
          rodada: doc.rodada,
          period: roundKey,
          totalResponses: 0,
          totalWeightedResponses: 0,
          distribution: new Map(),
        })
      }
      const roundData = processedData.get(roundKey)
      roundData.totalResponses += 1
      roundData.totalWeightedResponses += doc.weight

      if (!roundData.distribution.has(doc.mainAnswer)) {
        roundData.distribution.set(doc.mainAnswer, {
          response: doc.mainAnswer,
          count: 0,
          weightedCount: 0,
          demographics: {},
        })
      }
      const answerData = roundData.distribution.get(doc.mainAnswer)
      answerData.count += 1
      answerData.weightedCount += doc.weight

      // Processar TODOS os campos demográficos
      for (const [demoField, demoValue] of Object.entries(doc.demographics)) {
        if (demoValue && demoValue !== "") {
          if (!answerData.demographics[demoField]) {
            answerData.demographics[demoField] = new Map()
          }
          const demoFieldMap = answerData.demographics[demoField]
          if (!demoFieldMap.has(demoValue)) {
            demoFieldMap.set(demoValue, { response: demoValue, count: 0, weightedCount: 0 })
          }
          const demoValueData = demoFieldMap.get(demoValue)
          demoValueData.count += 1
          demoValueData.weightedCount += doc.weight
        }
      }
    }

    // 3. Finalize structure (convert maps to sorted arrays)
    const finalHistoricalData = Array.from(processedData.values())
      .map((round) => {
        round.distribution = Array.from(round.distribution.values())
          .map((answer) => {
            answer.weightedCount = Math.round(answer.weightedCount * 100) / 100

            // Processar todos os campos demográficos
            Object.keys(answer.demographics).forEach((demoField) => {
              answer.demographics[demoField] = Array.from(answer.demographics[demoField].values())
                .map((d) => ({
                  ...d,
                  weightedCount: Math.round(d.weightedCount * 100) / 100,
                }))
                .sort((a, b) => b.weightedCount - a.weightedCount)
            })
            return answer
          })
          .sort((a, b) => b.weightedCount - a.weightedCount)
        round.totalWeightedResponses = Math.round(round.totalWeightedResponses * 100) / 100
        return round
      })
      .sort((a, b) => b.year - a.year || b.rodada - a.rodada)

    const response = {
      success: true,
      questionCode: questionCodeUpper,
      questionInfo,
      historicalData: finalHistoricalData,
      demographicFields: demographicFields, // Lista dos campos incluídos
    }

    console.log(`✅ Resposta OTIMIZADA com TODOS os campos demográficos para ${questionCodeUpper} enviada.`)
    res.json(response)
  } catch (error) {
    console.error(`❌ Erro na busca OTIMIZADA para ${req.params.questionCode}:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
})

// GET /api/data/question/:questionCode/comparison
router.get("/question/:questionCode/comparison", async (req, res) => {
  try {
    const { questionCode } = req.params
    const { response: targetResponse } = req.query
    const questionCodeUpper = questionCode.toUpperCase()

    if (!targetResponse) {
      return res.status(400).json({
        success: false,
        message: "Parâmetro 'response' é obrigatório. Ex: ?response=Lula",
      })
    }

    console.log(`📈 Comparando evolução da resposta '${targetResponse}' para pergunta: ${questionCodeUpper}`)

    const QuestionIndex = await getModel("QuestionIndex")
    const questionInfo = await QuestionIndex.findOne({ variable: questionCodeUpper }).lean()

    if (!questionInfo) {
      return res.status(404).json({
        success: false,
        message: `Pergunta '${questionCode}' não encontrada no índice.`,
      })
    }

    const identicalQuestions = await QuestionIndex.find({
      questionText: questionInfo.questionText,
    }).lean()

    const questionCodes = identicalQuestions.map((q) => q.variable.toUpperCase())

    const responseModels = await getAllModels("Response")
    const evolutionData = []

    for (const Response of responseModels) {
      try {
        const pipeline = [
          { $match: { "answers.k": { $in: questionCodes } } },
          { $unwind: "$answers" },
          { $match: { "answers.k": { $in: questionCodes } } },
          {
            $group: {
              _id: { year: "$year", rodada: "$rodada", value: "$answers.v" },
              count: { $sum: 1 },
            },
          },
          {
            $group: {
              _id: { year: "$_id.year", rodada: "$_id.rodada" },
              totalResponses: { $sum: "$count" },
              targetCount: {
                $sum: {
                  $cond: [{ $eq: ["$_id.value", targetResponse] }, "$count", 0],
                },
              },
            },
          },
          { $sort: { "_id.year": 1, "_id.rodada": 1 } },
        ]

        const results = await Response.aggregate(pipeline, { maxTimeMS: 30000 })
        evolutionData.push(...results)
      } catch (dbError) {
        console.error(`Erro na comparação no banco ${Response.db.name}:`, dbError.message)
      }
    }

    const evolution = evolutionData.map((item) => ({
      year: item._id.year,
      rodada: item._id.rodada,
      period: `${item._id.year}-R${item._id.rodada}`,
      totalResponses: item.totalResponses,
      targetCount: item.targetCount,
      percentage: item.totalResponses > 0 ? ((item.targetCount / item.totalResponses) * 100).toFixed(1) : "0.0",
    }))

    res.json({
      success: true,
      questionCode: questionCodeUpper,
      targetResponse,
      evolution,
    })
  } catch (error) {
    console.error(`❌ Erro na comparação:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
})

// GET /api/data/search/questions
router.get("/search/questions", async (req, res) => {
  const { q } = req.query

  if (!q || q.length < 2) {
    return res.status(400).json({
      success: false,
      message: "Parâmetro 'q' é obrigatório e deve ter pelo menos 2 caracteres.",
    })
  }

  try {
    const QuestionIndex = await getModel("QuestionIndex")

    const searchResults = await QuestionIndex.find({
      $or: [
        { variable: { $regex: q, $options: "i" } },
        { questionText: { $regex: q, $options: "i" } },
        { label: { $regex: q, $options: "i" } },
        { index: { $regex: q, $options: "i" } },
      ],
    })
      .limit(20)
      .lean()

    res.json({
      success: true,
      searchTerm: q,
      count: searchResults.length,
      questions: searchResults,
    })
  } catch (error) {
    console.error("❌ Erro na busca de perguntas:", error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
})

// POST /api/data/themes/questions
router.get("/themes/questions", async (req, res) => {
  try {
    const { theme } = req.body

    if (!theme) {
      return res.status(400).json({
        success: false,
        message: "Campo 'theme' é obrigatório no body da requisição",
      })
    }

    console.log(`🎯 Buscando perguntas do tema: ${theme}`)

    const QuestionIndex = await getModel("QuestionIndex")

    const questions = await QuestionIndex.find({
      index: theme,
    })
      .select("variable questionText label surveyNumber surveyName")
      .sort({ variable: 1 })
      .lean()

    if (questions.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Nenhuma pergunta encontrada para o tema '${theme}'`,
      })
    }

    console.log(`✅ Encontradas ${questions.length} perguntas para o tema '${theme}'`)

    res.json({
      success: true,
      theme: theme,
      count: questions.length,
      questions: questions,
    })
  } catch (error) {
    console.error(`❌ Erro ao buscar perguntas do tema:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
})

module.exports = router
