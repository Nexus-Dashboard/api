// controllers/themesController.js
const { getModel } = require("../config/dbManager")
const { createSlug } = require("../utils/helpers")

// GET /api/data/themes?type=f2f
const getThemes = async (req, res) => {
  try {
    const dbKey = req.dbKey
    console.log(`🎯 Buscando temas disponíveis para [${dbKey}]...`)

    const QuestionIndex = await getModel("QuestionIndex", dbKey)

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
          Rodadas: { $addToSet: "$surveyNumber" },
        },
      },
      {
        $project: {
          _id: 0,
          theme: "$_id",
          questionCount: 1,
          Rodadas: {
            $map: {
              input: "$Rodadas",
              as: "r",
              in: {
                $cond: {
                  if: { $eq: [{ $type: "$$r" }, "string"] },
                  then: { $toInt: { $ifNull: ["$$r", 0] } },
                  else: "$$r",
                },
              },
            },
          },
        },
      },
      {
        $sort: { theme: 1 },
      },
    ])

    const themesWithSlug = themes.map((theme) => ({
      ...theme,
      slug: createSlug(theme.theme),
      id: createSlug(theme.theme),
    }))

    console.log(`✅ Encontrados ${themesWithSlug.length} temas para [${dbKey}]`)

    res.json({
      success: true,
      type: dbKey,
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
}

// GET /api/data/themes/:themeSlug/questions?type=f2f
const getThemeQuestions = async (req, res) => {
  try {
    const dbKey = req.dbKey
    const { themeSlug } = req.params
    console.log(`🎯 Buscando perguntas do tema com slug: ${themeSlug} para [${dbKey}]`)

    const QuestionIndex = await getModel("QuestionIndex", dbKey)

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

    const targetTheme = allThemes.find((theme) => createSlug(theme._id) === themeSlug)

    if (!targetTheme) {
      return res.status(404).json({
        success: false,
        message: `Tema com slug '${themeSlug}' não encontrado para o tipo '${dbKey}'`,
      })
    }

    const themeName = targetTheme._id

    const questions = await QuestionIndex.find({
      index: themeName,
    })
      .select("variable questionText label surveyNumber surveyName")
      .sort({ variable: 1 })
      .lean()

    console.log(`✅ Encontradas ${questions.length} perguntas para o tema '${themeName}' em [${dbKey}]`)

    res.json({
      success: true,
      type: dbKey,
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
}

// GET /api/data/themes/:theme/questions-grouped
const getGroupedQuestions = async (req, res) => {
  try {
    const dbKey = req.dbKey
    const { theme } = req.params
    console.log(`🎯 Agrupando perguntas do tema: ${theme} para [${dbKey}]`)

    const QuestionIndex = await getModel("QuestionIndex", dbKey)

    const allQuestions = await QuestionIndex.find({
      index: theme,
    })
      .select("variable questionText label surveyNumber surveyName date")
      .sort({ variable: 1, surveyNumber: 1 })
      .lean()

    if (allQuestions.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Nenhuma pergunta encontrada para o tema '${theme}' no tipo '${dbKey}'`,
      })
    }

    const getBaseQuestionCode = (variable) => {
      return variable.replace(/#\d+$/, "").replace(/_\d+$/, "")
    }

    const isMultipleQuestion = (variable) => {
      return variable.includes("#") || /_\d+$/.test(variable)
    }

    const textGroups = new Map()

    for (const question of allQuestions) {
      const key = question.questionText.trim()
      if (!textGroups.has(key)) {
        textGroups.set(key, [])
      }
      textGroups.get(key).push(question)
    }

    const finalGroups = []
    const processedVariables = new Set()

    // Processar perguntas múltiplas primeiro
    for (const question of allQuestions) {
      if (processedVariables.has(question.variable)) continue

      const baseCode = getBaseQuestionCode(question.variable)

      if (isMultipleQuestion(question.variable)) {
        const relatedQuestions = allQuestions.filter((q) => {
          const qBaseCode = getBaseQuestionCode(q.variable)
          return (
            qBaseCode === baseCode && q.surveyNumber === question.surveyNumber && !processedVariables.has(q.variable)
          )
        })

        if (relatedQuestions.length > 1) {
          const group = {
            id: `${theme}-multiple-${baseCode}-${question.surveyNumber}`,
            type: "multiple",
            baseCode: baseCode,
            questionText: question.questionText,
            theme: theme,
            surveyNumber: question.surveyNumber,
            surveyName: question.surveyName,
            date: question.date,
            subQuestions: relatedQuestions
              .map((q) => ({
                variable: q.variable,
                label: q.label || "",
                questionText: q.questionText,
                order: Number.parseInt(
                  q.variable.match(/#(\d+)$|_(\d+)$/)?.[1] || q.variable.match(/#(\d+)$|_(\d+)$/)?.[2] || "0",
                ),
              }))
              .sort((a, b) => a.order - b.order),
            variables: relatedQuestions.map((q) => q.variable),
            rounds: [question.surveyNumber],
            totalSubQuestions: relatedQuestions.length,
          }

          finalGroups.push(group)
          relatedQuestions.forEach((q) => processedVariables.add(q.variable))
        }
      }
    }

    // Processar perguntas agrupadas por texto
    let groupIndex = 0
    for (const [questionText, questions] of textGroups.entries()) {
      const unprocessedQuestions = questions.filter((q) => !processedVariables.has(q.variable))

      if (unprocessedQuestions.length === 0) continue

      const variables = new Set()
      const rounds = new Set()
      const variations = []

      for (const question of unprocessedQuestions) {
        variables.add(question.variable)
        rounds.add(question.surveyNumber)
        variations.push({
          variable: question.variable,
          surveyNumber: question.surveyNumber,
          surveyName: question.surveyName,
          date: question.date,
          label: question.label || "",
        })
      }

      const roundsArray = Array.from(rounds).sort((a, b) => Number.parseInt(a) - Number.parseInt(b))

      const group = {
        id: `${theme}-text-${groupIndex++}`,
        type: "text-grouped",
        questionText: questionText,
        shortText: questionText.length > 200 ? questionText.substring(0, 200) + "..." : questionText,
        theme: theme,
        variables: Array.from(variables).sort(),
        rounds: roundsArray,
        totalVariations: unprocessedQuestions.length,
        variations: variations.sort((a, b) => Number.parseInt(a.surveyNumber) - Number.parseInt(b.surveyNumber)),
        searchData: {
          theme: theme,
          questionText: questionText,
        },
      }

      finalGroups.push(group)
      unprocessedQuestions.forEach((q) => processedVariables.add(q.variable))
    }

    finalGroups.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "multiple" ? -1 : 1
      }
      if (a.type === "multiple") {
        return a.baseCode.localeCompare(b.baseCode)
      }
      return a.questionText.localeCompare(b.questionText)
    })

    console.log(`✅ Encontrados ${finalGroups.length} grupos de perguntas para o tema '${theme}' em [${dbKey}]`)

    const multipleQuestions = finalGroups.filter((g) => g.type === "multiple")
    const textGroupedQuestions = finalGroups.filter((g) => g.type === "text-grouped")

    res.json({
      success: true,
      type: dbKey,
      theme: theme,
      statistics: {
        totalGroups: finalGroups.length,
        multipleQuestions: multipleQuestions.length,
        textGroupedQuestions: textGroupedQuestions.length,
        totalQuestionsProcessed: processedVariables.size,
        totalQuestionsInTheme: allQuestions.length,
      },
      questionGroups: finalGroups,
      usage: {
        message: "Use os dados em 'searchData' para buscar o histórico completo da pergunta",
        endpoint: "POST /api/data/question/grouped/responses?type=" + dbKey,
        example: {
          textGrouped:
            textGroupedQuestions.length > 0
              ? {
                  theme: theme,
                  questionText: textGroupedQuestions[0].questionText,
                }
              : null,
          multiple:
            multipleQuestions.length > 0
              ? {
                  theme: theme,
                  variables: multipleQuestions[0].variables,
                  baseCode: multipleQuestions[0].baseCode,
                }
              : null,
        },
      },
    })
  } catch (error) {
    console.error(`❌ Erro ao agrupar perguntas do tema:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
}

// GET /api/data/themes/:theme/questions-summary
const getQuestionsSummary = async (req, res) => {
  try {
    const dbKey = req.dbKey
    const { theme } = req.params
    console.log(`📊 Gerando resumo das perguntas do tema: ${theme} para [${dbKey}]`)

    const QuestionIndex = await getModel("QuestionIndex", dbKey)

    const summary = await QuestionIndex.aggregate([
      {
        $match: {
          index: theme,
        },
      },
      {
        $group: {
          _id: "$questionText",
          variables: { $addToSet: "$variable" },
          rounds: { $addToSet: "$surveyNumber" },
          count: { $sum: 1 },
          firstDate: { $min: "$date" },
          lastDate: { $max: "$date" },
        },
      },
      {
        $project: {
          _id: 0,
          questionText: "$_id",
          shortText: {
            $cond: {
              if: { $gt: [{ $strLenCP: "$_id" }, 150] },
              then: { $concat: [{ $substr: ["$_id", 0, 150] }, "..."] },
              else: "$_id",
            },
          },
          variables: 1,
          rounds: 1,
          totalVariations: "$count",
          dateRange: {
            first: "$firstDate",
            last: "$lastDate",
          },
        },
      },
      {
        $sort: { totalVariations: -1, questionText: 1 },
      },
    ])

    console.log(`✅ Resumo gerado: ${summary.length} grupos de perguntas para [${dbKey}]`)

    res.json({
      success: true,
      type: dbKey,
      theme: theme,
      totalGroups: summary.length,
      questionGroups: summary.map((group, index) => ({
        id: `${theme}-summary-${index + 1}`,
        ...group,
        searchData: {
          theme: theme,
          questionText: group.questionText,
        },
      })),
      usage: {
        message: "Use os dados em 'searchData' para buscar o histórico completo",
        endpoint: "POST /api/data/question/grouped/responses?type=" + dbKey,
      },
    })
  } catch (error) {
    console.error(`❌ Erro ao gerar resumo do tema:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
}

// POST /api/data/themes/questions
const postThemeQuestions = async (req, res) => {
  try {
    const dbKey = req.dbKey
    const { theme } = req.body

    if (!theme) {
      return res.status(400).json({
        success: false,
        message: "Campo 'theme' é obrigatório no body da requisição",
      })
    }

    console.log(`🎯 Buscando perguntas do tema: ${theme} para [${dbKey}]`)

    const QuestionIndex = await getModel("QuestionIndex", dbKey)

    const questions = await QuestionIndex.find({
      index: theme,
    })
      .select("variable questionText label surveyNumber surveyName")
      .sort({ variable: 1 })
      .lean()

    if (questions.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Nenhuma pergunta encontrada para o tema '${theme}' no tipo '${dbKey}'`,
      })
    }

    console.log(`✅ Encontradas ${questions.length} perguntas para o tema '${theme}' em [${dbKey}]`)

    res.json({
      success: true,
      type: dbKey,
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
}

module.exports = {
  getThemes,
  getThemeQuestions,
  getGroupedQuestions,
  getQuestionsSummary,
  postThemeQuestions,
}
