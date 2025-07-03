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
    const questionCodeUpper = questionCode.toUpperCase()

    console.log(`🔍 Buscando respostas históricas para pergunta: ${questionCodeUpper}`)

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
    let historicalData = []

    for (const Response of responseModels) {
      const dbName = Response.db.name
      console.log(`  📊 Consultando banco: ${dbName} para pergunta principal`)

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
              distribution: { $push: { response: "$_id.value", count: "$count" } },
            },
          },
          { $sort: { "_id.year": 1, "_id.rodada": 1 } },
        ]
        const results = await Response.aggregate(pipeline, { maxTimeMS: 60000 })
        historicalData.push(...results)
      } catch (dbError) {
        console.error(`  ❌ Erro no banco ${dbName}:`, dbError.message)
      }
    }

    // Consolidar dados de diferentes bancos, se houver
    const consolidatedData = historicalData.reduce((acc, round) => {
      const key = `${round._id.year}-R${round._id.rodada}`
      if (!acc[key]) {
        acc[key] = { ...round._id, totalResponses: 0, distribution: [] }
      }
      acc[key].totalResponses += round.totalResponses
      acc[key].distribution.push(...round.distribution)
      return acc
    }, {})
    historicalData = Object.values(consolidatedData)

    // Buscar dados demográficos para as rodadas encontradas
    const roundsToFetch = historicalData.map((r) => ({ year: r.year, rodada: r.rodada }))
    console.log(`📋 Buscando dados demográficos para ${roundsToFetch.length} rodadas...`)
    const demographicData =
      roundsToFetch.length > 0 ? await getDemographicDataForRounds(roundsToFetch, responseModels) : {}
    console.log(`✅ Dados demográficos encontrados para ${Object.keys(demographicData).length} rodadas.`)

    const rodadas = historicalData
      .sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year
        return a.rodada - b.rodada
      })
      .map((rodada) => {
        const roundKey = `${rodada.year}-R${rodada.rodada}`
        const sortedDistribution = rodada.distribution.sort((a, b) => b.count - a.count)
        const distributionWithPercentage = sortedDistribution.map((item) => ({
          response: item.response,
          count: item.count,
          percentage: ((item.count / rodada.totalResponses) * 100).toFixed(1),
        }))

        return {
          year: rodada.year,
          rodada: rodada.rodada,
          period: roundKey,
          totalResponses: rodada.totalResponses,
          distribution: distributionWithPercentage,
          demographics: demographicData[roundKey] || {}, // Adiciona os dados demográficos
        }
      })

    const allResponses = {}
    let totalGeral = 0
    rodadas.forEach((rodada) => {
      rodada.distribution.forEach((item) => {
        const response = String(item.response || "Não informado")
        allResponses[response] = (allResponses[response] || 0) + item.count
        totalGeral += item.count
      })
    })

    const resumoGeral = Object.entries(allResponses)
      .map(([response, count]) => ({
        response: response,
        count: count,
        percentage: totalGeral > 0 ? ((count / totalGeral) * 100).toFixed(1) : "0.0",
      }))
      .sort((a, b) => b.count - a.count)

    const response = {
      success: true,
      questionCode: questionCodeUpper,
      questionInfo,
      identicalQuestions: identicalQuestions.map((q) => ({
        variable: q.variable,
        surveyNumber: q.surveyNumber,
        surveyName: q.surveyName,
      })),
      summary: {
        totalRodadas: rodadas.length,
        totalResponses: totalGeral,
        questionsIncluded: questionCodes.length,
        periodRange: rodadas.length > 0 ? `${rodadas[0].period} até ${rodadas[rodadas.length - 1].period}` : null,
      },
      resumoGeral,
      historicalData: rodadas,
    }

    console.log(
      `✅ Pergunta ${questionCodeUpper}: ${totalGeral} respostas em ${rodadas.length} rodadas de ${questionCodes.length} perguntas com texto idêntico`,
    )

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
