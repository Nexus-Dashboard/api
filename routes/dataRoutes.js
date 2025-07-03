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
    .replace(/-+/g, "-") // Remove hífens duplicados
    .trim("-") // Remove hífens do início/fim
}

// Função auxiliar para buscar dados demográficos
async function getDemographicDataForRounds(rounds, responseModels) {
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
  const demographicDataByRound = {}

  const pipeline = [
    // 1. Filtrar apenas pelas rodadas que nos interessam
    {
      $match: {
        $or: rounds.map((r) => ({ year: r.year, rodada: r.rodada })),
      },
    },
    // 2. Projetar os campos demográficos e o peso para o nível superior
    {
      $project: {
        year: 1,
        rodada: 1,
        // Extrai cada campo demográfico do array 'answers'
        ...demographicFields.reduce((acc, field) => {
          acc[field] = {
            $let: {
              vars: { ans: { $filter: { input: "$answers", cond: { $eq: ["$$this.k", field] } } } },
              in: { $arrayElemAt: ["$$ans.v", 0] },
            },
          }
          return acc
        }, {}),
        // Extrai o campo de peso usando regex
        weight: {
          $let: {
            vars: {
              ans: {
                $filter: {
                  input: "$answers",
                  cond: { $regexMatch: { input: "$$this.k", regex: /weights/i } },
                },
              },
            },
            in: { $arrayElemAt: ["$$ans.v", 0] },
          },
        },
      },
    },
    // 3. Usar $facet para calcular todas as distribuições de uma vez
    {
      $facet: demographicFields.reduce((acc, field) => {
        acc[field] = [
          { $match: { [field]: { $exists: true, $ne: null, $ne: "" } } },
          { $group: { _id: { year: "$year", rodada: "$rodada", value: `$${field}` }, count: { $sum: 1 } } },
          {
            $group: {
              _id: { year: "$_id.year", rodada: "$_id.rodada" },
              distribution: { $push: { response: "$_id.value", count: "$count" } },
            },
          },
        ]
        return acc
      }, {}),
    },
  ]

  for (const Response of responseModels) {
    const results = await Response.aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 60000 })
    const facetResult = results[0]

    for (const [field, fieldData] of Object.entries(facetResult)) {
      for (const roundData of fieldData) {
        const roundKey = `${roundData._id.year}-R${roundData._id.rodada}`
        if (!demographicDataByRound[roundKey]) {
          demographicDataByRound[roundKey] = {}
        }
        // Calcular total e percentuais para a distribuição deste campo
        const total = roundData.distribution.reduce((sum, item) => sum + item.count, 0)
        demographicDataByRound[roundKey][field] = roundData.distribution
          .map((item) => ({
            ...item,
            percentage: ((item.count / total) * 100).toFixed(1),
          }))
          .sort((a, b) => b.count - a.count)
      }
    }
  }

  return demographicDataByRound
}

// NOVA FUNÇÃO: Busca o breakdown demográfico para uma resposta específica em dadas rodadas
async function getDemographicBreakdownForAnswer(questionCodes, targetResponse, rounds, responseModels) {
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
  const finalBreakdown = {}

  // Pipeline para encontrar entrevistados que deram a resposta alvo
  // e depois agregar seus dados demográficos
  const pipeline = [
    // 1. Filtrar pelas rodadas de interesse
    {
      $match: {
        $or: rounds.map((r) => ({ year: r.year, rodada: r.rodada })),
      },
    },
    // 2. Adicionar um campo que verifica se o entrevistado deu a resposta alvo
    {
      $addFields: {
        isTargetResponse: {
          $gt: [
            {
              $size: {
                $filter: {
                  input: "$answers",
                  as: "ans",
                  cond: {
                    $and: [{ $in: ["$$ans.k", questionCodes] }, { $eq: ["$$ans.v", targetResponse] }],
                  },
                },
              },
            },
            0,
          ],
        },
      },
    },
    // 3. Manter apenas os que deram a resposta alvo
    { $match: { isTargetResponse: true } },
    // 4. Projetar os campos demográficos para o nível superior para facilitar a agregação
    {
      $project: {
        ...demographicFields.reduce((acc, field) => {
          acc[field] = {
            $let: {
              vars: { ans: { $filter: { input: "$answers", cond: { $eq: ["$$this.k", field] } } } },
              in: { $arrayElemAt: ["$$ans.v", 0] },
            },
          }
          return acc
        }, {}),
      },
    },
    // 5. Usar $facet para agregar todos os campos demográficos de uma vez
    {
      $facet: demographicFields.reduce((acc, field) => {
        acc[field] = [
          { $match: { [field]: { $exists: true, $ne: null, $ne: "" } } },
          { $group: { _id: `$${field}`, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $project: { _id: 0, response: "$_id", count: "$count" } },
        ]
        return acc
      }, {}),
    },
  ]

  for (const Response of responseModels) {
    const results = await Response.aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 90000 })
    if (results.length > 0) {
      const facetResult = results[0]
      for (const [field, data] of Object.entries(facetResult)) {
        if (!finalBreakdown[field]) finalBreakdown[field] = []
        // Consolidar resultados de diferentes bancos
        data.forEach((item) => {
          const existing = finalBreakdown[field].find((i) => i.response === item.response)
          if (existing) {
            existing.count += item.count
          } else {
            finalBreakdown[field].push(item)
          }
        })
      }
    }
  }

  // Ordenar a consolidação final
  for (const field in finalBreakdown) {
    finalBreakdown[field].sort((a, b) => b.count - a.count)
  }

  return finalBreakdown
}

// GET /api/data/themes
router.get("/themes", async (req, res) => {
  try {
    console.log("🎯 Buscando temas disponíveis...")

    const QuestionIndex = await getModel("QuestionIndex", "main")

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

// GET /api/data/themes/:themeSlug/questions
router.get("/themes/:themeSlug/questions", async (req, res) => {
  try {
    const { themeSlug } = req.params
    console.log(`🎯 Buscando perguntas do tema com slug: ${themeSlug}`)

    const QuestionIndex = await getModel("QuestionIndex", "main")

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

// GET /api/data/question/:questionCode/responses
router.get("/question/:questionCode/responses", async (req, res) => {
  try {
    const { questionCode } = req.params
    const { page = 1, limit = 10 } = req.query // Parâmetros de paginação
    const questionCodeUpper = questionCode.toUpperCase()

    console.log(`🔍 Buscando respostas para ${questionCodeUpper}, página: ${page}, limite: ${limit}`)

    const QuestionIndex = await getModel("QuestionIndex", "main")
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
    const allRounds = []

    // 1. Obter a lista de TODAS as rodadas disponíveis primeiro
    for (const Response of responseModels) {
      const pipeline = [
        { $match: { "answers.k": { $in: questionCodes } } },
        {
          $group: {
            _id: { year: "$year", rodada: "$rodada" },
          },
        },
        { $sort: { "_id.year": -1, "_id.rodada": -1 } }, // Mais recentes primeiro
      ]
      const results = await Response.aggregate(pipeline, { maxTimeMS: 60000 })
      allRounds.push(...results.map((r) => r._id))
    }

    // Consolidar e ordenar todas as rodadas
    const uniqueRounds = Array.from(new Map(allRounds.map((r) => [`${r.year}-${r.rodada}`, r])).values()).sort(
      (a, b) => b.year - a.year || b.rodada - a.rodada,
    )

    // 2. Paginar a lista de rodadas
    const totalRounds = uniqueRounds.length
    const totalPages = Math.ceil(totalRounds / limit)
    const startIndex = (page - 1) * limit
    const endIndex = page * limit
    const paginatedRounds = uniqueRounds.slice(startIndex, endIndex)

    if (paginatedRounds.length === 0 && totalRounds > 0) {
      return res.status(404).json({
        success: false,
        message: `Página ${page} não encontrada. Apenas ${totalPages} páginas disponíveis.`,
      })
    }

    console.log(`📋 Processando ${paginatedRounds.length} rodadas para a página ${page}...`)

    // 3. Processar apenas as rodadas da página atual
    const processedData = []
    for (const round of paginatedRounds) {
      const roundDistribution = []
      let totalResponsesInRound = 0

      // Obter distribuição da pergunta principal para esta rodada
      for (const Response of responseModels) {
        const distPipeline = [
          { $match: { year: round.year, rodada: round.rodada, "answers.k": { $in: questionCodes } } },
          { $unwind: "$answers" },
          { $match: { "answers.k": { $in: questionCodes } } },
          { $group: { _id: "$answers.v", count: { $sum: 1 } } },
        ]
        const distResults = await Response.aggregate(distPipeline)
        distResults.forEach((item) => {
          const existing = roundDistribution.find((i) => i.response === item._id)
          if (existing) {
            existing.count += item.count
          } else {
            roundDistribution.push({ response: item._id, count: item.count })
          }
          totalResponsesInRound += item.count
        })
      }

      // Para cada resposta na distribuição, buscar o breakdown demográfico
      for (const item of roundDistribution) {
        console.log(`  -> Detalhando '${item.response}' para ${round.year}-R${round.rodada}`)
        item.demographics = await getDemographicBreakdownForAnswer(
          questionCodes,
          item.response,
          [round], // Apenas para a rodada atual
          responseModels,
        )
      }

      processedData.push({
        year: round.year,
        rodada: round.rodada,
        period: `${round.year}-R${round.rodada}`,
        totalResponses: totalResponsesInRound,
        distribution: roundDistribution.sort((a, b) => b.count - a.count),
      })
    }

    const response = {
      success: true,
      questionCode: questionCodeUpper,
      questionInfo,
      pagination: {
        currentPage: Number.parseInt(page),
        limit: Number.parseInt(limit),
        totalPages: totalPages,
        totalRounds: totalRounds,
        hasNextPage: endIndex < totalRounds,
      },
      historicalData: processedData,
    }

    console.log(`✅ Resposta da página ${page} para ${questionCodeUpper} enviada.`)
    res.json(response)
  } catch (error) {
    console.error(`❌ Erro ao buscar respostas para pergunta ${req.params.questionCode}:`, error)
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

    const QuestionIndex = await getModel("QuestionIndex", "main")
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
    const QuestionIndex = await getModel("QuestionIndex", "main")

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
router.post("/themes/questions", async (req, res) => {
  try {
    const { theme } = req.body

    if (!theme) {
      return res.status(400).json({
        success: false,
        message: "Campo 'theme' é obrigatório no body da requisição",
      })
    }

    console.log(`🎯 Buscando perguntas do tema: ${theme}`)

    const QuestionIndex = await getModel("QuestionIndex", "main")

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
