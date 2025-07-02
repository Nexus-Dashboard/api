// routes/dataRoutes.js
const express = require("express")
const router = express.Router()
const { getModel, getAllModels } = require("../config/dbManager")

// GET /api/data/themes
// Retorna todos os temas disponíveis (valores únicos da coluna 'Index')
router.get("/themes", async (req, res) => {
  try {
    console.log("🎯 Buscando temas disponíveis...")

    const QuestionIndex = getModel("QuestionIndex", "main")

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

    console.log(`✅ Encontrados ${themes.length} temas`)

    res.json({
      success: true,
      count: themes.length,
      themes: themes,
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

// GET /api/data/themes/:themeName/questions
// Retorna todas as perguntas de um tema específico
router.get("/themes/:themeName/questions", async (req, res) => {
  try {
    const { themeName } = req.params
    console.log(`🎯 Buscando perguntas do tema: ${themeName}`)

    const QuestionIndex = getModel("QuestionIndex", "main")

    const questions = await QuestionIndex.find({
      index: themeName,
    })
      .select("variable questionText label surveyNumber surveyName")
      .sort({ variable: 1 })
      .lean()

    if (questions.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Nenhuma pergunta encontrada para o tema '${themeName}'`,
      })
    }

    console.log(`✅ Encontradas ${questions.length} perguntas para o tema '${themeName}'`)

    res.json({
      success: true,
      theme: themeName,
      count: questions.length,
      questions: questions,
    })
  } catch (error) {
    console.error(`❌ Erro ao buscar perguntas do tema ${req.params.themeName}:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
})

// GET /api/data/question/:questionCode/responses
// Retorna respostas apenas de perguntas com TEXTO IDÊNTICO
router.get("/question/:questionCode/responses", async (req, res) => {
  try {
    const { questionCode } = req.params
    const { format } = req.query // ?format=detailed para mais detalhes
    const questionCodeUpper = questionCode.toUpperCase()

    console.log(`🔍 Buscando respostas para pergunta: ${questionCodeUpper}`)

    // 1. Buscar informações da pergunta no índice
    const QuestionIndex = getModel("QuestionIndex", "main")
    const questionInfo = await QuestionIndex.findOne({
      variable: questionCodeUpper,
    }).lean()

    if (!questionInfo) {
      return res.status(404).json({
        success: false,
        message: `Pergunta '${questionCode}' não encontrada no índice.`,
      })
    }

    // 2. Buscar TODAS as perguntas com o mesmo texto
    const identicalQuestions = await QuestionIndex.find({
      questionText: questionInfo.questionText,
      variable: { $exists: true, $ne: null, $ne: "" },
    }).lean()

    const questionCodes = identicalQuestions.map((q) => q.variable.toUpperCase())
    console.log(`📋 Perguntas com texto idêntico: ${questionCodes.join(", ")}`)

    // 3. Buscar dados em todos os bancos de dados para TODAS as perguntas com texto idêntico
    const responseModels = getAllModels("Response")
    const allResults = []
    const detailedResults = []

    for (const Response of responseModels) {
      const dbName = Response.db.name
      console.log(`  📊 Consultando banco: ${dbName}`)

      // Pipeline básico para contagem de respostas
      const basicPipeline = [
        {
          $match: {
            "answers.k": { $in: questionCodes },
          },
        },
        { $unwind: "$answers" },
        {
          $match: {
            "answers.k": { $in: questionCodes },
          },
        },
        {
          $group: {
            _id: "$answers.v",
            count: { $sum: 1 },
          },
        },
      ]

      const basicResults = await Response.aggregate(basicPipeline)
      allResults.push(...basicResults)

      // Se formato detalhado, buscar também por ano e rodada
      if (format === "detailed") {
        const detailedPipeline = [
          {
            $match: {
              "answers.k": { $in: questionCodes },
            },
          },
          { $unwind: "$answers" },
          {
            $match: {
              "answers.k": { $in: questionCodes },
            },
          },
          {
            $group: {
              _id: {
                value: "$answers.v",
                year: "$year",
                rodada: "$rodada",
                questionCode: "$answers.k",
              },
              count: { $sum: 1 },
            },
          },
          {
            $group: {
              _id: "$_id.value",
              totalCount: { $sum: "$count" },
              byPeriod: {
                $push: {
                  year: "$_id.year",
                  rodada: "$_id.rodada",
                  questionCode: "$_id.questionCode",
                  count: "$count",
                },
              },
            },
          },
        ]

        const detailed = await Response.aggregate(detailedPipeline)
        detailedResults.push(...detailed)
      }
    }

    // 4. Unificar os resultados básicos
    const finalDistribution = allResults.reduce((acc, current) => {
      const value = String(current._id || "Não informado")
      if (acc[value]) {
        acc[value].count += current.count
      } else {
        acc[value] = {
          response: current._id,
          count: current.count,
        }
      }
      return acc
    }, {})

    const sortedDistribution = Object.values(finalDistribution).sort((a, b) => b.count - a.count)

    const totalResponses = sortedDistribution.reduce((sum, item) => sum + item.count, 0)

    // 5. Preparar resposta
    const response = {
      success: true,
      questionCode: questionCodeUpper,
      questionInfo,
      identicalQuestions: identicalQuestions.map((q) => ({
        variable: q.variable,
        surveyNumber: q.surveyNumber,
        surveyName: q.surveyName,
      })),
      totalResponses,
      distribution: sortedDistribution,
      summary: {
        totalOptions: sortedDistribution.length,
        mostCommonResponse: sortedDistribution[0]?.response || null,
        mostCommonCount: sortedDistribution[0]?.count || 0,
        questionsIncluded: questionCodes.length,
      },
    }

    // 6. Adicionar detalhes se solicitado
    if (format === "detailed") {
      const detailedDistribution = detailedResults.reduce((acc, current) => {
        const value = String(current._id || "Não informado")
        if (acc[value]) {
          acc[value].totalCount += current.totalCount
          acc[value].byPeriod.push(...current.byPeriod)
        } else {
          acc[value] = {
            response: current._id,
            totalCount: current.totalCount,
            byPeriod: current.byPeriod,
          }
        }
        return acc
      }, {})

      response.detailedDistribution = Object.values(detailedDistribution).sort((a, b) => b.totalCount - a.totalCount)
    }

    console.log(
      `✅ Pergunta ${questionCodeUpper}: ${totalResponses} respostas de ${questionCodes.length} perguntas com texto idêntico`,
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

// GET /api/data/question/:questionCode/timeline
// Timeline considerando apenas perguntas com texto idêntico
router.get("/question/:questionCode/timeline", async (req, res) => {
  try {
    const { questionCode } = req.params
    const questionCodeUpper = questionCode.toUpperCase()

    console.log(`📈 Gerando timeline para pergunta: ${questionCodeUpper}`)

    // 1. Buscar perguntas com texto idêntico
    const QuestionIndex = getModel("QuestionIndex", "main")
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
    }).lean()

    const questionCodes = identicalQuestions.map((q) => q.variable.toUpperCase())

    // 2. Buscar timeline em todos os bancos
    const responseModels = getAllModels("Response")
    const timelineData = []

    for (const Response of responseModels) {
      const pipeline = [
        {
          $match: {
            "answers.k": { $in: questionCodes },
          },
        },
        { $unwind: "$answers" },
        {
          $match: {
            "answers.k": { $in: questionCodes },
          },
        },
        {
          $group: {
            _id: {
              year: "$year",
              rodada: "$rodada",
              value: "$answers.v",
            },
            count: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: {
              year: "$_id.year",
              rodada: "$_id.rodada",
            },
            totalResponses: { $sum: "$count" },
            distribution: {
              $push: {
                value: "$_id.value",
                count: "$count",
              },
            },
          },
        },
        {
          $sort: {
            "_id.year": 1,
            "_id.rodada": 1,
          },
        },
      ]

      const results = await Response.aggregate(pipeline)
      timelineData.push(...results)
    }

    // 3. Ordenar timeline final
    const sortedTimeline = timelineData.sort((a, b) => {
      if (a._id.year !== b._id.year) {
        return a._id.year - b._id.year
      }
      return a._id.rodada - b._id.rodada
    })

    res.json({
      success: true,
      questionCode: questionCodeUpper,
      questionInfo,
      questionsIncluded: questionCodes,
      timeline: sortedTimeline.map((item) => ({
        year: item._id.year,
        rodada: item._id.rodada,
        period: `${item._id.year}-R${item._id.rodada}`,
        totalResponses: item.totalResponses,
        distribution: item.distribution.sort((a, b) => b.count - a.count),
      })),
    })
  } catch (error) {
    console.error(`❌ Erro ao gerar timeline para pergunta ${req.params.questionCode}:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
})

// GET /api/data/search/questions
// Busca perguntas por texto ou código
router.get("/search/questions", async (req, res) => {
  const { q } = req.query

  if (!q || q.length < 2) {
    return res.status(400).json({
      success: false,
      message: "Parâmetro 'q' é obrigatório e deve ter pelo menos 2 caracteres.",
    })
  }

  try {
    const QuestionIndex = getModel("QuestionIndex", "main")

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

module.exports = router
