// controllers/questionsController.js
const { getModel, getAllModels } = require("../config/dbManager")
const { processSpecificQuestion } = require("../services/questionProcessingService")

// GET /api/data/questions/all?type=f2f
const getAllQuestions = async (req, res) => {
  try {
    const dbKey = req.dbKey
    const { page = 1, limit = 50, search, index: themeFilter } = req.query

    console.log(`🎯 Buscando todas as perguntas do índice para [${dbKey}]...`)

    const QuestionIndex = await getModel("QuestionIndex", dbKey)

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

    const skip = (page - 1) * limit
    const total = await QuestionIndex.countDocuments(filters)

    const questions = await QuestionIndex.find(filters)
      .sort({ surveyNumber: 1, variable: 1 })
      .skip(skip)
      .limit(Number.parseInt(limit))
      .lean()

    console.log(`✅ Encontradas ${questions.length} perguntas (total: ${total}) para [${dbKey}]`)

    res.json({
      success: true,
      type: dbKey,
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
}

// GET /api/data/question/:questionCode/responses
const getQuestionResponses = async (req, res) => {
  try {
    const dbKey = req.dbKey
    const { questionCode } = req.params
    const { theme, surveyNumber, questionText, keywords } = req.query

    const questionCodeDecoded = decodeURIComponent(questionCode).toUpperCase()

    console.log(
      `⚡️ Executando busca OTIMIZADA para pergunta específica ${questionCodeDecoded} no tema ${theme} para [${dbKey}]`,
    )

    const QuestionIndex = await getModel("QuestionIndex", dbKey)

    const questionFilters = {
      variable: questionCodeDecoded,
    }

    if (theme) {
      questionFilters.index = theme
    }

    if (surveyNumber) {
      questionFilters.surveyNumber = surveyNumber.toString()
    }

    if (questionText) {
      const decodedQuestionText = decodeURIComponent(questionText)
      console.log(`🔍 Buscando por texto da pergunta: ${decodedQuestionText.substring(0, 100)}...`)

      const exactMatch = await QuestionIndex.findOne({
        ...questionFilters,
        questionText: decodedQuestionText,
      }).lean()

      if (exactMatch) {
        console.log(`✅ Encontrada correspondência exata para o texto da pergunta`)
        const response = await processSpecificQuestion(exactMatch, questionCodeDecoded, theme, dbKey)
        return res.json({ ...response, type: dbKey })
      } else {
        questionFilters.questionText = {
          $regex: decodedQuestionText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        }
      }
    }

    if (keywords && !questionText) {
      const keywordArray = keywords.split(",").map((k) => k.trim())
      const keywordRegex = keywordArray
        .map((keyword) => `(?=.*${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`)
        .join("")
      questionFilters.questionText = { $regex: keywordRegex, $options: "i" }
      console.log(`🔍 Buscando por palavras-chave: ${keywordArray.join(", ")}`)
    }

    console.log(`🔍 Filtros de busca:`, JSON.stringify(questionFilters, null, 2))

    const questionInfo = await QuestionIndex.findOne(questionFilters).lean()

    if (!questionInfo) {
      console.log(`❌ Pergunta não encontrada com os filtros especificados`)

      const variableExists = await QuestionIndex.findOne({ variable: questionCodeDecoded }).lean()

      if (variableExists) {
        const allVariations = await QuestionIndex.find({ variable: questionCodeDecoded }).lean()
        return res.status(404).json({
          success: false,
          type: dbKey,
          message: `Pergunta '${questionCode}' não encontrada com os filtros especificados.`,
          suggestions: {
            availableThemes: [...new Set(allVariations.map((v) => v.index))],
            availableRounds: [...new Set(allVariations.map((v) => v.surveyNumber))],
            totalVariations: allVariations.length,
          },
          hint: "Use /api/data/question/" + questionCode + "/variations para ver todas as opções disponíveis",
        })
      } else {
        return res.status(404).json({
          success: false,
          type: dbKey,
          message: `Pergunta '${questionCode}' não encontrada no índice.`,
        })
      }
    }

    const response = await processSpecificQuestion(questionInfo, questionCodeDecoded, theme, dbKey)
    res.json({ ...response, type: dbKey })
  } catch (error) {
    console.error(`❌ Erro na busca OTIMIZADA para ${req.params.questionCode}:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
}

// GET /api/data/question/:questionCode/responses/:questionId
const getQuestionResponsesById = async (req, res) => {
  try {
    const dbKey = req.dbKey
    const { questionCode, questionId } = req.params
    const questionCodeUpper = questionCode.toUpperCase()

    console.log(`⚡️ Executando busca por ID específico da pergunta: ${questionId} para [${dbKey}]`)

    const QuestionIndex = await getModel("QuestionIndex", dbKey)

    const questionInfo = await QuestionIndex.findById(questionId).lean()

    if (!questionInfo) {
      return res.status(404).json({
        success: false,
        type: dbKey,
        message: `Pergunta com ID '${questionId}' não encontrada.`,
      })
    }

    if (questionInfo.variable.toUpperCase() !== questionCodeUpper) {
      return res.status(400).json({
        success: false,
        type: dbKey,
        message: `ID da pergunta não corresponde à variável ${questionCodeUpper}.`,
      })
    }

    console.log(`📋 Pergunta encontrada: ${questionInfo.questionText}`)
    console.log(`📋 Rodada da pergunta: ${questionInfo.surveyNumber}`)

    const questionCodes = [questionInfo.variable.toUpperCase()]
    const surveyNumbers = [questionInfo.surveyNumber]

    const responseModels = await getAllModels("Response", dbKey)
    const rawData = []

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
      "PF10",
    ]

    for (const Response of responseModels) {
      console.log(`🔍 Processando banco [${dbKey}]: ${Response.db.name}`)

      const pipeline = [
        {
          $match: {
            "answers.k": { $in: questionCodes },
            rodada: { $in: surveyNumbers.map((s) => Number.parseInt(s)) },
          },
        },
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

    if (rawData.length === 0) {
      return res.json({
        success: true,
        type: dbKey,
        questionCode: questionCodeUpper,
        questionInfo,
        historicalData: [],
        message: "Nenhuma resposta encontrada para esta pergunta específica.",
        demographicFields: demographicFields,
      })
    }

    // Processar dados (mesmo código de processamento da rota anterior)
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

    const finalHistoricalData = Array.from(processedData.values())
      .map((round) => {
        round.distribution = Array.from(round.distribution.values())
          .map((answer) => {
            answer.weightedCount = Math.round(answer.weightedCount * 100) / 100
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
      type: dbKey,
      questionCode: questionCodeUpper,
      questionId: questionId,
      questionInfo,
      historicalData: finalHistoricalData,
      demographicFields: demographicFields,
      specificRound: questionInfo.surveyNumber,
    }

    console.log(
      `✅ Resposta para pergunta específica ${questionCodeUpper} (ID: ${questionId}) enviada para [${dbKey}].`,
    )
    res.json(response)
  } catch (error) {
    console.error(`❌ Erro na busca por ID específico:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
}

// GET /api/data/question/:questionCode/variations
const getQuestionVariations = async (req, res) => {
  try {
    const dbKey = req.dbKey
    const { questionCode } = req.params
    const { theme } = req.query

    const questionCodeDecoded = decodeURIComponent(questionCode).toUpperCase()

    console.log(`🔍 Buscando todas as variações da pergunta ${questionCodeDecoded} para [${dbKey}]`)

    const QuestionIndex = await getModel("QuestionIndex", dbKey)

    const filters = { variable: questionCodeDecoded }
    if (theme) {
      filters.index = theme
    }

    const variations = await QuestionIndex.find(filters)
      .select("_id variable questionText surveyNumber surveyName index date")
      .sort({ surveyNumber: 1 })
      .lean()

    if (variations.length === 0) {
      return res.status(404).json({
        success: false,
        type: dbKey,
        message: `Nenhuma variação encontrada para a pergunta '${questionCode}'${theme ? ` no tema '${theme}'` : ""} no tipo '${dbKey}'.`,
      })
    }

    console.log(`✅ Encontradas ${variations.length} variações da pergunta ${questionCodeDecoded} para [${dbKey}]`)

    res.json({
      success: true,
      type: dbKey,
      questionCode: questionCodeDecoded,
      theme: theme || "Todos os temas",
      totalVariations: variations.length,
      variations: variations.map((v) => ({
        id: v._id,
        surveyNumber: v.surveyNumber,
        surveyName: v.surveyName,
        questionText: v.questionText,
        theme: v.index,
        date: v.date,
        shortText: v.questionText.length > 100 ? v.questionText.substring(0, 100) + "..." : v.questionText,
      })),
    })
  } catch (error) {
    console.error(`❌ Erro ao buscar variações da pergunta:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
}

// GET /api/data/question/:questionCode/preview
const getQuestionPreview = async (req, res) => {
  try {
    const dbKey = req.dbKey
    const { questionCode } = req.params
    const { theme } = req.query

    const questionCodeDecoded = decodeURIComponent(questionCode).toUpperCase()
    console.log(`🔍 Buscando prévia das variações da pergunta ${questionCodeDecoded} para [${dbKey}]`)

    const QuestionIndex = await getModel("QuestionIndex", dbKey)

    const filters = { variable: questionCodeDecoded }
    if (theme) {
      filters.index = theme
    }

    const variations = await QuestionIndex.find(filters)
      .select("_id variable questionText surveyNumber surveyName index date possibleAnswers")
      .sort({ surveyNumber: 1 })
      .lean()

    if (variations.length === 0) {
      return res.status(404).json({
        success: false,
        type: dbKey,
        message: `Nenhuma variação encontrada para a pergunta '${questionCode}'${theme ? ` no tema '${theme}'` : ""} no tipo '${dbKey}'.`,
      })
    }

    const extractKeywords = (text) => {
      if (!text) return []

      const stopWords = [
        "o",
        "a",
        "os",
        "as",
        "de",
        "da",
        "do",
        "das",
        "dos",
        "em",
        "na",
        "no",
        "nas",
        "nos",
        "para",
        "por",
        "com",
        "sem",
        "sobre",
        "entre",
        "até",
        "desde",
        "durante",
        "através",
        "você",
        "sua",
        "seu",
        "suas",
        "seus",
        "que",
        "qual",
        "quais",
        "como",
        "quando",
        "onde",
        "estimulada",
        "única",
        "não",
        "ler",
        "sim",
        "ou",
        "e",
        "é",
        "são",
        "foi",
        "será",
        "tem",
        "ter",
        "teve",
        "terá",
        "governo",
        "brasileiro",
        "brasil",
        "federal",
      ]

      return text
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 3 && !stopWords.includes(word))
        .slice(0, 5)
    }

    const previewData = variations.map((v) => {
      const keywords = extractKeywords(v.questionText)
      const shortText = v.questionText.length > 150 ? v.questionText.substring(0, 150) + "..." : v.questionText

      let mainTopic = "Geral"
      const text = v.questionText.toLowerCase()

      if (text.includes("lula") || text.includes("bolsonaro") || text.includes("presidente")) {
        mainTopic = "Política/Eleições"
      } else if (
        text.includes("economia") ||
        text.includes("inflação") ||
        text.includes("emprego") ||
        text.includes("tarifa")
      ) {
        mainTopic = "Economia"
      } else if (text.includes("israel") || text.includes("hamas") || text.includes("guerra") || text.includes("paz")) {
        mainTopic = "Conflitos Internacionais"
      } else if (text.includes("g20") || text.includes("fome") || text.includes("aliança")) {
        mainTopic = "Cooperação Internacional"
      } else if (text.includes("saúde") || text.includes("sus") || text.includes("médico")) {
        mainTopic = "Saúde"
      }

      return {
        id: v._id,
        surveyNumber: v.surveyNumber,
        surveyName: v.surveyName,
        questionText: v.questionText,
        shortText: shortText,
        theme: v.index,
        date: v.date,
        keywords: keywords,
        mainTopic: mainTopic,
        possibleAnswers: v.possibleAnswers || [],
        hasAnswers: (v.possibleAnswers || []).length > 0,
      }
    })

    console.log(
      `✅ Prévia gerada para ${previewData.length} variações da pergunta ${questionCodeDecoded} para [${dbKey}]`,
    )

    res.json({
      success: true,
      type: dbKey,
      questionCode: questionCodeDecoded,
      theme: theme || "Todos os temas",
      totalVariations: previewData.length,
      variations: previewData,
      selectionHelp: {
        message: "Use o 'id' da variação escolhida na rota: /api/data/question/" + questionCode + "/responses/{id}",
        alternativeMessage:
          "Ou use surveyNumber: /api/data/question/" +
          questionCode +
          "/responses?theme=" +
          (theme || "TEMA") +
          "&surveyNumber=NUMERO",
      },
    })
  } catch (error) {
    console.error(`❌ Erro ao buscar prévia da pergunta:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
}

// GET /api/data/question/:questionCode/smart-search
const getSmartSearch = async (req, res) => {
  try {
    const dbKey = req.dbKey
    const { questionCode } = req.params
    const { theme, hint } = req.query

    const questionCodeDecoded = decodeURIComponent(questionCode).toUpperCase()
    console.log(`🧠 Busca inteligente para pergunta ${questionCodeDecoded} com hint: "${hint}" para [${dbKey}]`)

    const QuestionIndex = await getModel("QuestionIndex", dbKey)

    const filters = { variable: questionCodeDecoded }
    if (theme) {
      filters.index = theme
    }

    const allVariations = await QuestionIndex.find(filters)
      .select("_id variable questionText surveyNumber surveyName index date possibleAnswers")
      .sort({ surveyNumber: 1 })
      .lean()

    if (allVariations.length === 0) {
      return res.status(404).json({
        success: false,
        type: dbKey,
        message: `Nenhuma variação encontrada para a pergunta '${questionCode}'${theme ? ` no tema '${theme}'` : ""} no tipo '${dbKey}'.`,
      })
    }

    let bestMatches = allVariations

    if (hint && hint.length > 2) {
      const hintLower = hint.toLowerCase()

      bestMatches = allVariations
        .map((variation) => {
          const textLower = variation.questionText.toLowerCase()
          let score = 0

          const hintWords = hintLower.split(/\s+/).filter((w) => w.length > 2)
          hintWords.forEach((word) => {
            if (textLower.includes(word)) {
              score += 10
            }
          })

          if (hintLower.includes("israel") && textLower.includes("israel")) score += 20
          if (hintLower.includes("hamas") && textLower.includes("hamas")) score += 20
          if (hintLower.includes("lula") && textLower.includes("lula")) score += 20
          if (hintLower.includes("bolsonaro") && textLower.includes("bolsonaro")) score += 20
          if (hintLower.includes("economia") && textLower.includes("economia")) score += 15
          if (hintLower.includes("tarifa") && textLower.includes("tarifa")) score += 15
          if (hintLower.includes("g20") && textLower.includes("g20")) score += 15
          if (hintLower.includes("fome") && textLower.includes("fome")) score += 15

          return { ...variation, relevanceScore: score }
        })
        .filter((v) => v.relevanceScore > 0)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
    }

    const suggestions = bestMatches.slice(0, 5).map((v, index) => {
      const shortText = v.questionText.length > 200 ? v.questionText.substring(0, 200) + "..." : v.questionText

      return {
        id: v._id,
        rank: index + 1,
        surveyNumber: v.surveyNumber,
        surveyName: v.surveyName,
        questionText: v.questionText,
        shortText: shortText,
        theme: v.index,
        date: v.date,
        relevanceScore: v.relevanceScore || 0,
        possibleAnswers: v.possibleAnswers || [],
        directUrl: `/api/data/question/${questionCode}/responses/${v._id}?type=${dbKey}`,
        alternativeUrl: `/api/data/question/${questionCode}/responses?theme=${encodeURIComponent(theme || v.index)}&surveyNumber=${v.surveyNumber}&type=${dbKey}`,
      }
    })

    res.json({
      success: true,
      type: dbKey,
      questionCode: questionCodeDecoded,
      searchHint: hint || "Nenhuma dica fornecida",
      theme: theme || "Todos os temas",
      totalFound: bestMatches.length,
      topSuggestions: suggestions,
      usage: {
        message: "Escolha uma das sugestões e use a 'directUrl' ou 'alternativeUrl' para buscar os dados",
        example: suggestions.length > 0 ? suggestions[0].directUrl : "Nenhuma sugestão disponível",
      },
    })
  } catch (error) {
    console.error(`❌ Erro na busca inteligente:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
}

// GET /api/data/question/:questionCode/comparison
const getQuestionComparison = async (req, res) => {
  try {
    const dbKey = req.dbKey
    const { questionCode } = req.params
    const { response: targetResponse } = req.query
    const questionCodeUpper = questionCode.toUpperCase()

    if (!targetResponse) {
      return res.status(400).json({
        success: false,
        type: dbKey,
        message: "Parâmetro 'response' é obrigatório. Ex: ?response=Lula",
      })
    }

    console.log(
      `📈 Comparando evolução da resposta '${targetResponse}' para pergunta: ${questionCodeUpper} em [${dbKey}]`,
    )

    const QuestionIndex = await getModel("QuestionIndex", dbKey)
    const questionInfo = await QuestionIndex.findOne({ variable: questionCodeUpper }).lean()

    if (!questionInfo) {
      return res.status(404).json({
        success: false,
        type: dbKey,
        message: `Pergunta '${questionCode}' não encontrada no índice.`,
      })
    }

    const identicalQuestions = await QuestionIndex.find({
      questionText: questionInfo.questionText,
    }).lean()

    const questionCodes = identicalQuestions.map((q) => q.variable.toUpperCase())

    const responseModels = await getAllModels("Response", dbKey)
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
      type: dbKey,
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
}

// POST /api/data/question/:questionCode/responses
const postQuestionResponses = async (req, res) => {
  try {
    const dbKey = req.dbKey
    const { questionCode } = req.params
    const { theme, questionText, surveyNumber } = req.body

    if (!theme) {
      return res.status(400).json({
        success: false,
        message: "Campo 'theme' é obrigatório no body da requisição",
      })
    }

    if (!questionText) {
      return res.status(400).json({
        success: false,
        message: "Campo 'questionText' é obrigatório no body da requisição",
      })
    }

    const questionCodeDecoded = decodeURIComponent(questionCode).toUpperCase()

    console.log(`⚡️ Busca POST para pergunta ${questionCodeDecoded} em [${dbKey}]`)
    console.log(`📋 Tema: ${theme}`)
    console.log(`📋 Texto da pergunta: ${questionText.substring(0, 100)}...`)

    const QuestionIndex = await getModel("QuestionIndex", dbKey)

    const questionFilters = {
      variable: questionCodeDecoded,
      index: theme,
      questionText: questionText.trim(),
    }

    if (surveyNumber) {
      questionFilters.surveyNumber = surveyNumber.toString()
    }

    console.log(`🔍 Filtros aplicados:`, {
      variable: questionFilters.variable,
      index: questionFilters.index,
      questionTextLength: questionFilters.questionText.length,
      surveyNumber: questionFilters.surveyNumber || "Não especificado",
    })

    const questionInfo = await QuestionIndex.findOne(questionFilters).lean()

    if (!questionInfo) {
      console.log(`❌ Pergunta não encontrada com os filtros exatos`)

      const availableVariations = await QuestionIndex.find({
        variable: questionCodeDecoded,
        index: theme,
      })
        .select("surveyNumber questionText")
        .lean()

      return res.status(404).json({
        success: false,
        type: dbKey,
        message: `Pergunta '${questionCode}' não encontrada com o texto exato fornecido no tema '${theme}' no tipo '${dbKey}'.`,
        availableVariations: availableVariations.map((v) => ({
          surveyNumber: v.surveyNumber,
          questionTextPreview: v.questionText.substring(0, 150) + "...",
        })),
        hint: "Verifique se o texto da pergunta está exatamente igual ao armazenado no banco de dados.",
      })
    }

    console.log(`✅ Pergunta encontrada: Rodada ${questionInfo.surveyNumber}`)

    const response = await processSpecificQuestion(questionInfo, questionCodeDecoded, theme, dbKey)

    response.searchMethod = "POST com texto exato"
    response.type = dbKey
    response.matchedFilters = {
      variable: questionCodeDecoded,
      theme: theme,
      surveyNumber: questionInfo.surveyNumber,
      questionTextMatched: true,
    }

    res.json(response)
  } catch (error) {
    console.error(`❌ Erro na busca POST para ${req.params.questionCode}:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
}

module.exports = {
  getAllQuestions,
  getQuestionResponses,
  getQuestionResponsesById,
  getQuestionVariations,
  getQuestionPreview,
  getSmartSearch,
  getQuestionComparison,
  postQuestionResponses,
}
