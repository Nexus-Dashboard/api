// routes/dataRoutes.js
const express = require("express")
const router = express.Router()
const { getModel, getAllModels } = require("../config/dbManager")

// Função para criar slug normalizado
function createSlug(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove acentos
    .replace(/[^a-z0-9\s-]/g, "") // Remove caracteres especiais
    .replace(/\s+/g, "-") // Substitui espaços por hífens
    .replace(/-+/g, "-") // Remove hífens duplicados
    .trim("-") // Remove hífens do início/fim
}

// GET /api/data/themes
// Retorna todos os temas disponíveis (valores únicos da coluna 'Index')
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
// Retorna respostas organizadas por rodada para análise histórica
router.get("/question/:questionCode/responses", async (req, res) => {
  try {
    const { questionCode } = req.params
    const questionCodeUpper = questionCode.toUpperCase()

    console.log(`🔍 Buscando respostas históricas para pergunta: ${questionCodeUpper}`)

    // 1. Buscar informações da pergunta no índice
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

    // 2. Buscar TODAS as perguntas com o mesmo texto
    const identicalQuestions = await QuestionIndex.find({
      questionText: questionInfo.questionText,
      variable: { $exists: true, $ne: null, $ne: "" },
    }).lean()

    const questionCodes = identicalQuestions.map((q) => q.variable.toUpperCase())
    console.log(`📋 Perguntas com texto idêntico: ${questionCodes.join(", ")}`)

    // 3. Buscar dados históricos organizados por rodada com timeout otimizado
    const responseModels = await getAllModels("Response")
    const historicalData = []

    for (const Response of responseModels) {
      const dbName = Response.db.name
      console.log(`  📊 Consultando banco: ${dbName}`)

      try {
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
                  response: "$_id.value",
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

        // Executar agregação com timeout reduzido
        const results = await Response.aggregate(pipeline, { maxTimeMS: 30000 }) // 30 segundos
        historicalData.push(...results)

        console.log(`  ✅ Banco ${dbName}: ${results.length} rodadas encontradas`)
      } catch (dbError) {
        console.error(`  ❌ Erro no banco ${dbName}:`, dbError.message)
        // Continuar com outros bancos mesmo se um falhar
      }
    }

    // 4. Organizar dados por rodada e calcular percentuais
    const rodadas = historicalData
      .sort((a, b) => {
        if (a._id.year !== b._id.year) {
          return a._id.year - b._id.year
        }
        return a._id.rodada - b._id.rodada
      })
      .map((rodada) => {
        // Ordenar distribuição por contagem (maior para menor)
        const sortedDistribution = rodada.distribution.sort((a, b) => b.count - a.count)

        // Calcular percentuais
        const distributionWithPercentage = sortedDistribution.map((item) => ({
          response: item.response,
          count: item.count,
          percentage: ((item.count / rodada.totalResponses) * 100).toFixed(1),
        }))

        return {
          year: rodada._id.year,
          rodada: rodada._id.rodada,
          period: `${rodada._id.year}-R${rodada._id.rodada}`,
          totalResponses: rodada.totalResponses,
          distribution: distributionWithPercentage,
        }
      })

    // 5. Calcular resumo geral (agregado de todas as rodadas)
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

    // 6. Preparar resposta final
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
// Compara a evolução de uma resposta específica ao longo das rodadas
router.get("/question/:questionCode/comparison", async (req, res) => {
  try {
    const { questionCode } = req.params
    const { response: targetResponse } = req.query // ?response=Lula
    const questionCodeUpper = questionCode.toUpperCase()

    if (!targetResponse) {
      return res.status(400).json({
        success: false,
        message: "Parâmetro 'response' é obrigatório. Ex: ?response=Lula",
      })
    }

    console.log(`📈 Comparando evolução da resposta '${targetResponse}' para pergunta: ${questionCodeUpper}`)

    // Reutilizar a lógica da rota anterior para obter dados históricos
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

    // Buscar dados específicos para a resposta alvo
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

module.exports = router
