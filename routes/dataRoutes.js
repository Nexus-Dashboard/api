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
          Rodadas: { $addToSet: "$surveyNumber" }, // Agrupa todas as rodadas únicas
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
                  then: { $toInt: "$$r" }, // Converte strings numéricas em inteiros
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

// POST /api/data/question/grouped/responses
// Busca histórico completo de perguntas agrupadas, incluindo suporte para perguntas múltiplas
router.post("/question/grouped/responses", async (req, res) => {
  try {
    const { theme, questionText, variables, baseCode } = req.body

    // Validações
    if (!theme) {
      return res.status(400).json({
        success: false,
        message: "Campo 'theme' é obrigatório no body da requisição",
      })
    }

    // Deve ter questionText OU variables
    if (!questionText && (!variables || variables.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "É necessário fornecer 'questionText' ou 'variables' no body da requisição",
      })
    }

    const QuestionIndex = await getModel("QuestionIndex")
    let identicalQuestions = []
    let searchType = ''

    // Se foram fornecidas variáveis específicas (caso de perguntas múltiplas)
    if (variables && variables.length > 0) {
      console.log(`⚡️ Busca por perguntas múltiplas: ${variables.join(', ')} no tema: ${theme}`)
      searchType = 'multiple'
      
      identicalQuestions = await QuestionIndex.find({
        index: theme,
        variable: { $in: variables }
      }).lean()

    } else if (questionText) {
      console.log(`⚡️ Busca agrupada para pergunta no tema: ${theme}`)
      console.log(`📋 Texto da pergunta: ${questionText.substring(0, 100)}...`)
      searchType = 'text'

      identicalQuestions = await QuestionIndex.find({
        index: theme,
        questionText: questionText.trim(),
      }).lean()
    }

    if (identicalQuestions.length === 0) {
      return res.status(404).json({
        success: false,
        message: searchType === 'multiple' 
          ? `Nenhuma pergunta encontrada com as variáveis fornecidas no tema '${theme}'.`
          : `Nenhuma pergunta encontrada com o texto fornecido no tema '${theme}'.`,
      })
    }

    console.log(`✅ Encontradas ${identicalQuestions.length} variações da pergunta`)

    // Extrair todas as variáveis e rodadas
    const questionCodes = identicalQuestions.map((q) => q.variable.toUpperCase())
    const surveyNumbers = identicalQuestions.map((q) => q.surveyNumber)
    const variablesByRound = identicalQuestions.reduce((acc, q) => {
      if (!acc[q.surveyNumber]) acc[q.surveyNumber] = []
      acc[q.surveyNumber].push(q.variable)
      return acc
    }, {})

    console.log(`📋 Variáveis encontradas: ${questionCodes.join(", ")}`)
    console.log(`📋 Rodadas correspondentes: ${surveyNumbers.join(", ")}`)

    const responseModels = await getAllModels("Response")
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

    // Buscar dados de todas as rodadas
    for (const Response of responseModels) {
      console.log(`🔍 Processando banco: ${Response.db.name}`)

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
            // Para perguntas múltiplas, precisamos capturar todas as respostas relevantes
            answers: {
              $filter: {
                input: "$answers",
                cond: { $in: ["$$this.k", questionCodes] }
              }
            },
            weight: {
              $let: {
                vars: {
                  weightAns: {
                    $filter: { input: "$answers", cond: { $regexMatch: { input: "$$this.k", regex: /weights/i } } },
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
                  input: { $filter: { input: "$answers", cond: { $in: ["$$this.k", demographicFields] } } },
                  as: "item",
                  in: { k: "$$item.k", v: "$$item.v" },
                },
              },
            },
          },
        },
        { $match: { answers: { $ne: [] } } },
      ]

      const results = await Response.aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 120000 })
      rawData.push(...results)
    }

    console.log(`📊 Total de registros brutos coletados: ${rawData.length}`)

    if (rawData.length === 0) {
      return res.json({
        success: true,
        theme: theme,
        searchType: searchType,
        questionText: questionText || null,
        variables: variables || null,
        baseCode: baseCode || null,
        questionInfo: {
          variables: questionCodes,
          rounds: surveyNumbers,
          totalVariations: identicalQuestions.length,
        },
        historicalData: [],
        message: "Nenhuma resposta encontrada para esta pergunta nas rodadas correspondentes.",
        demographicFields: demographicFields,
      })
    }

    // Processar dados - adaptado para perguntas múltiplas
    const processedData = new Map()

    for (const doc of rawData) {
      const roundKey = `${doc.year}-R${doc.rodada}`
      if (!processedData.has(roundKey)) {
        processedData.set(roundKey, {
          year: doc.year,
          rodada: doc.rodada,
          period: roundKey,
          variables: variablesByRound[doc.rodada.toString()] || [],
          totalResponses: 0,
          totalWeightedResponses: 0,
          distribution: searchType === 'multiple' ? {} : new Map(),
        })
      }
      const roundData = processedData.get(roundKey)
      roundData.totalResponses += 1
      roundData.totalWeightedResponses += doc.weight

      // Para perguntas múltiplas, processar cada resposta separadamente
      if (searchType === 'multiple') {
        for (const answer of doc.answers) {
          const variable = answer.k
          const value = answer.v

          if (!roundData.distribution[variable]) {
            roundData.distribution[variable] = new Map()
          }

          if (!roundData.distribution[variable].has(value)) {
            roundData.distribution[variable].set(value, {
              response: value,
              count: 0,
              weightedCount: 0,
              demographics: {},
            })
          }

          const answerData = roundData.distribution[variable].get(value)
          answerData.count += 1
          answerData.weightedCount += doc.weight

          // Processar demographics
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
      } else {
        // Processamento padrão para perguntas agrupadas por texto
        const mainAnswer = doc.answers[0]?.v
        if (!mainAnswer) continue

        if (!roundData.distribution.has(mainAnswer)) {
          roundData.distribution.set(mainAnswer, {
            response: mainAnswer,
            count: 0,
            weightedCount: 0,
            demographics: {},
          })
        }
        const answerData = roundData.distribution.get(mainAnswer)
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
    }

    // Finalizar processamento
    const finalHistoricalData = Array.from(processedData.values())
      .map((round) => {
        if (searchType === 'multiple') {
          // Para perguntas múltiplas, converter cada Map em array
          const distributionByVariable = {}
          for (const [variable, distribution] of Object.entries(round.distribution)) {
            distributionByVariable[variable] = Array.from(distribution.values())
              .map((answer) => {
                answer.weightedCount = Math.round(answer.weightedCount * 100) / 100
                Object.keys(answer.demographics).forEach((demoField) => {
                  answer.demographics[demoField] = Array.from(answer.demographics[demoField].values())
                    .map((d) => ({ ...d, weightedCount: Math.round(d.weightedCount * 100) / 100 }))
                    .sort((a, b) => b.weightedCount - a.weightedCount)
                })
                return answer
              })
              .sort((a, b) => b.weightedCount - a.weightedCount)
          }
          round.distribution = distributionByVariable
        } else {
          round.distribution = Array.from(round.distribution.values())
            .map((answer) => {
              answer.weightedCount = Math.round(answer.weightedCount * 100) / 100
              Object.keys(answer.demographics).forEach((demoField) => {
                answer.demographics[demoField] = Array.from(answer.demographics[demoField].values())
                  .map((d) => ({ ...d, weightedCount: Math.round(d.weightedCount * 100) / 100 }))
                  .sort((a, b) => b.weightedCount - a.weightedCount)
              })
              return answer
            })
            .sort((a, b) => b.weightedCount - a.weightedCount)
        }
        round.totalWeightedResponses = Math.round(round.totalWeightedResponses * 100) / 100
        return round
      })
      .sort((a, b) => b.year - a.year || b.rodada - a.rodada)

    // Adicionar informações sobre labels para perguntas múltiplas
    let labelsInfo = null
    if (searchType === 'multiple') {
      labelsInfo = identicalQuestions.reduce((acc, q) => {
        acc[q.variable] = q.label || q.questionText
        return acc
      }, {})
    }

    const response = {
      success: true,
      searchMethod: searchType === 'multiple' ? "Perguntas múltiplas" : "Agrupado por questionText + theme",
      searchType: searchType,
      theme: theme,
      questionText: questionText || null,
      baseCode: baseCode || null,
      questionInfo: {
        variables: questionCodes,
        rounds: surveyNumbers,
        totalVariations: identicalQuestions.length,
        variablesByRound: variablesByRound,
        labels: labelsInfo
      },
      historicalData: finalHistoricalData,
      demographicFields: demographicFields,
      summary: {
        totalRoundsWithData: finalHistoricalData.length,
        totalResponses: finalHistoricalData.reduce((sum, round) => sum + round.totalResponses, 0),
        totalWeightedResponses:
          Math.round(finalHistoricalData.reduce((sum, round) => sum + round.totalWeightedResponses, 0) * 100) / 100,
      },
    }

    console.log(`✅ Resposta agrupada enviada: ${finalHistoricalData.length} rodadas com dados`)
    res.json(response)
  } catch (error) {
    console.error(`❌ Erro na busca agrupada:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
})

// GET /api/data/question/:questionCode/responses - VERSÃO CORRIGIDA PARA BUSCAR APENAS A PERGUNTA ESPECÍFICA
router.get("/question/:questionCode/responses", async (req, res) => {
  try {
    const { questionCode } = req.params
    const { theme, surveyNumber, questionText, keywords } = req.query

    // CORREÇÃO 1: Decodificar a URL para lidar com caracteres especiais como #
    const questionCodeDecoded = decodeURIComponent(questionCode).toUpperCase()

    console.log(`⚡️ Executando busca OTIMIZADA para pergunta específica ${questionCodeDecoded} no tema ${theme}`)

    const QuestionIndex = await getModel("QuestionIndex")

    // CORREÇÃO 2: Melhorar a lógica de busca da pergunta específica
    const questionFilters = {
      variable: questionCodeDecoded,
    }

    if (theme) {
      questionFilters.index = theme
    }

    if (surveyNumber) {
      questionFilters.surveyNumber = surveyNumber.toString()
    }

    // CORREÇÃO 3: Melhorar a busca por questionText
    if (questionText) {
      // Decodificar o texto da pergunta
      const decodedQuestionText = decodeURIComponent(questionText)
      console.log(`🔍 Buscando por texto da pergunta: ${decodedQuestionText.substring(0, 100)}...`)

      // Usar busca exata primeiro, depois busca por regex se não encontrar
      const exactMatch = await QuestionIndex.findOne({
        ...questionFilters,
        questionText: decodedQuestionText,
      }).lean()

      if (exactMatch) {
        console.log(`✅ Encontrada correspondência exata para o texto da pergunta`)
        const response = await processSpecificQuestion(exactMatch, questionCodeDecoded, theme)
        return res.json(response)
      } else {
        // Se não encontrar correspondência exata, tentar busca por regex
        questionFilters.questionText = {
          $regex: decodedQuestionText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        }
      }
    }

    // CORREÇÃO 4: Adicionar busca por palavras-chave como alternativa
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
      // CORREÇÃO 5: Melhorar mensagem de erro com sugestões
      console.log(`❌ Pergunta não encontrada com os filtros especificados`)

      // Tentar buscar apenas pela variável para ver se existe
      const variableExists = await QuestionIndex.findOne({ variable: questionCodeDecoded }).lean()

      if (variableExists) {
        const allVariations = await QuestionIndex.find({ variable: questionCodeDecoded }).lean()
        return res.status(404).json({
          success: false,
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
          message: `Pergunta '${questionCode}' não encontrada no índice.`,
        })
      }
    }

    const response = await processSpecificQuestion(questionInfo, questionCodeDecoded, theme)
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

// CORREÇÃO 6: Criar função auxiliar para processar pergunta específica
async function processSpecificQuestion(questionInfo, questionCodeDecoded, theme) {
  console.log(`📋 Pergunta encontrada: ${questionInfo.questionText.substring(0, 100)}...`)
  console.log(`📋 Rodada da pergunta: ${questionInfo.surveyNumber}`)

  // Buscar APENAS perguntas que tenham exatamente o mesmo questionText, variable E index (tema)
  const QuestionIndex = await getModel("QuestionIndex")
  const identicalQuestions = await QuestionIndex.find({
    questionText: questionInfo.questionText,
    variable: questionCodeDecoded,
    index: questionInfo.index, // Usar o index da pergunta encontrada
  }).lean()

  const questionCodes = identicalQuestions.map((q) => q.variable.toUpperCase())
  const surveyNumbers = identicalQuestions.map((q) => q.surveyNumber)

  console.log(`📋 Perguntas idênticas encontradas: ${questionCodes.join(", ")}`)
  console.log(`📋 Rodadas correspondentes: ${surveyNumbers.join(", ")}`)

  const responseModels = await getAllModels("Response")
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

  // Buscar dados apenas das rodadas específicas
  for (const Response of responseModels) {
    console.log(`🔍 Processando banco: ${Response.db.name}`)

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
              vars: { ans: { $filter: { input: "$answers", cond: { $in: ["$$this.k", questionCodes] } } } },
              in: { $arrayElemAt: ["$$ans.v", 0] },
            },
          },
          weight: {
            $let: {
              vars: {
                weightAns: {
                  $filter: { input: "$answers", cond: { $regexMatch: { input: "$$this.k", regex: /weights/i } } },
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
                input: { $filter: { input: "$answers", cond: { $in: ["$$this.k", demographicFields] } } },
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
    return {
      success: true,
      questionCode: questionCodeDecoded,
      questionInfo,
      historicalData: [],
      message: "Nenhuma resposta encontrada para esta pergunta específica nas rodadas correspondentes.",
      demographicFields: demographicFields,
    }
  }

  // Processar dados (mesmo código anterior)
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
              .map((d) => ({ ...d, weightedCount: Math.round(d.weightedCount * 100) / 100 }))
              .sort((a, b) => b.weightedCount - a.weightedCount)
          })
          return answer
        })
        .sort((a, b) => b.weightedCount - a.weightedCount)
      round.totalWeightedResponses = Math.round(round.totalWeightedResponses * 100) / 100
      return round
    })
    .sort((a, b) => b.year - a.year || b.rodada - a.rodada)

  return {
    success: true,
    questionCode: questionCodeDecoded,
    questionInfo,
    historicalData: finalHistoricalData,
    demographicFields: demographicFields,
    availableRounds: surveyNumbers,
  }
}

// GET /api/data/question/:questionCode/responses/:questionId - BUSCA POR ID ESPECÍFICO DA PERGUNTA
router.get("/question/:questionCode/responses/:questionId", async (req, res) => {
  try {
    const { questionCode, questionId } = req.params
    const questionCodeUpper = questionCode.toUpperCase()

    console.log(`⚡️ Executando busca por ID específico da pergunta: ${questionId}`)

    const QuestionIndex = await getModel("QuestionIndex")

    // Buscar a pergunta específica pelo ID
    const questionInfo = await QuestionIndex.findById(questionId).lean()

    if (!questionInfo) {
      return res.status(404).json({
        success: false,
        message: `Pergunta com ID '${questionId}' não encontrada.`,
      })
    }

    if (questionInfo.variable.toUpperCase() !== questionCodeUpper) {
      return res.status(400).json({
        success: false,
        message: `ID da pergunta não corresponde à variável ${questionCodeUpper}.`,
      })
    }

    console.log(`📋 Pergunta encontrada: ${questionInfo.questionText}`)
    console.log(`📋 Rodada da pergunta: ${questionInfo.surveyNumber}`)

    // Buscar apenas esta pergunta específica (mesmo ID)
    const questionCodes = [questionInfo.variable.toUpperCase()]
    const surveyNumbers = [questionInfo.surveyNumber]

    const responseModels = await getAllModels("Response")
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

    // Buscar dados apenas da rodada específica
    for (const Response of responseModels) {
      console.log(`🔍 Processando banco: ${Response.db.name}`)

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
      questionCode: questionCodeUpper,
      questionId: questionId,
      questionInfo,
      historicalData: finalHistoricalData,
      demographicFields: demographicFields,
      specificRound: questionInfo.surveyNumber,
    }

    console.log(`✅ Resposta para pergunta específica ${questionCodeUpper} (ID: ${questionId}) enviada.`)
    res.json(response)
  } catch (error) {
    console.error(`❌ Erro na busca por ID específico:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
})

// GET /api/data/question/:questionCode/variations - LISTA TODAS AS VARIAÇÕES DE UMA PERGUNTA
router.get("/question/:questionCode/variations", async (req, res) => {
  try {
    const { questionCode } = req.params
    const { theme } = req.query

    // CORREÇÃO: Decodificar a URL para lidar com caracteres especiais
    const questionCodeDecoded = decodeURIComponent(questionCode).toUpperCase()

    console.log(`🔍 Buscando todas as variações da pergunta ${questionCodeDecoded}`)

    const QuestionIndex = await getModel("QuestionIndex")

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
        message: `Nenhuma variação encontrada para a pergunta '${questionCode}'${theme ? ` no tema '${theme}'` : ""}.`,
      })
    }

    console.log(`✅ Encontradas ${variations.length} variações da pergunta ${questionCodeDecoded}`)

    res.json({
      success: true,
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
})

// GET /api/data/question/:questionCode/preview - PRÉVIA DAS VARIAÇÕES COM TEXTO RESUMIDO
router.get("/question/:questionCode/preview", async (req, res) => {
  try {
    const { questionCode } = req.params
    const { theme } = req.query

    const questionCodeDecoded = decodeURIComponent(questionCode).toUpperCase()
    console.log(`🔍 Buscando prévia das variações da pergunta ${questionCodeDecoded}`)

    const QuestionIndex = await getModel("QuestionIndex")

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
        message: `Nenhuma variação encontrada para a pergunta '${questionCode}'${theme ? ` no tema '${theme}'` : ""}.`,
      })
    }

    // Extrair palavras-chave principais de cada pergunta
    const extractKeywords = (text) => {
      if (!text) return []

      // Palavras comuns a ignorar
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
        .replace(/[^\w\s]/g, " ") // Remove pontuação
        .split(/\s+/)
        .filter((word) => word.length > 3 && !stopWords.includes(word))
        .slice(0, 5) // Pega as 5 primeiras palavras relevantes
    }

    const previewData = variations.map((v) => {
      const keywords = extractKeywords(v.questionText)
      const shortText = v.questionText.length > 150 ? v.questionText.substring(0, 150) + "..." : v.questionText

      // Identificar o tema principal da pergunta
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

    console.log(`✅ Prévia gerada para ${previewData.length} variações da pergunta ${questionCodeDecoded}`)

    res.json({
      success: true,
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
})

// GET /api/data/question/:questionCode/smart-search - BUSCA INTELIGENTE COM SUGESTÕES
router.get("/question/:questionCode/smart-search", async (req, res) => {
  try {
    const { questionCode } = req.params
    const { theme, hint } = req.query

    const questionCodeDecoded = decodeURIComponent(questionCode).toUpperCase()
    console.log(`🧠 Busca inteligente para pergunta ${questionCodeDecoded} com hint: "${hint}"`)

    const QuestionIndex = await getModel("QuestionIndex")

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
        message: `Nenhuma variação encontrada para a pergunta '${questionCode}'${theme ? ` no tema '${theme}'` : ""}.`,
      })
    }

    let bestMatches = allVariations

    // Se foi fornecida uma dica, filtrar por relevância
    if (hint && hint.length > 2) {
      const hintLower = hint.toLowerCase()

      bestMatches = allVariations
        .map((variation) => {
          const textLower = variation.questionText.toLowerCase()
          let score = 0

          // Pontuação por palavras-chave encontradas
          const hintWords = hintLower.split(/\s+/).filter((w) => w.length > 2)
          hintWords.forEach((word) => {
            if (textLower.includes(word)) {
              score += 10
            }
          })

          // Pontuação por temas específicos
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
        directUrl: `/api/data/question/${questionCode}/responses/${v._id}`,
        alternativeUrl: `/api/data/question/${questionCode}/responses?theme=${encodeURIComponent(theme || v.index)}&surveyNumber=${v.surveyNumber}`,
      }
    })

    res.json({
      success: true,
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

// POST /api/data/question/:questionCode/responses - BUSCA EXATA POR TEXTO DA PERGUNTA NO BODY
router.post("/question/:questionCode/responses", async (req, res) => {
  try {
    const { questionCode } = req.params
    const { theme, questionText, surveyNumber } = req.body

    // Validações
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

    console.log(`⚡️ Busca POST para pergunta ${questionCodeDecoded}`)
    console.log(`📋 Tema: ${theme}`)
    console.log(`📋 Texto da pergunta: ${questionText.substring(0, 100)}...`)

    const QuestionIndex = await getModel("QuestionIndex")

    // Filtros exatos: variable + theme + questionText
    const questionFilters = {
      variable: questionCodeDecoded,
      index: theme,
      questionText: questionText.trim(), // Correspondência exata
    }

    // Filtro adicional por surveyNumber se fornecido
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

      // Tentar buscar variações disponíveis para ajudar o usuário
      const availableVariations = await QuestionIndex.find({
        variable: questionCodeDecoded,
        index: theme,
      })
        .select("surveyNumber questionText")
        .lean()

      return res.status(404).json({
        success: false,
        message: `Pergunta '${questionCode}' não encontrada com o texto exato fornecido no tema '${theme}'.`,
        availableVariations: availableVariations.map((v) => ({
          surveyNumber: v.surveyNumber,
          questionTextPreview: v.questionText.substring(0, 150) + "...",
        })),
        hint: "Verifique se o texto da pergunta está exatamente igual ao armazenado no banco de dados.",
      })
    }

    console.log(`✅ Pergunta encontrada: Rodada ${questionInfo.surveyNumber}`)

    // Processar a pergunta específica encontrada
    const response = await processSpecificQuestion(questionInfo, questionCodeDecoded, theme)

    // Adicionar informações extras na resposta
    response.searchMethod = "POST com texto exato"
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
})

// Adicionar após as rotas existentes, antes do module.exports

// GET /api/data/themes/:theme/questions-grouped
// Agrupa perguntas de um tema pelo questionText, incluindo perguntas múltiplas e sequenciais
router.get("/themes/:theme/questions-grouped", async (req, res) => {
  try {
    const { theme } = req.params
    console.log(`🎯 Agrupando perguntas do tema: ${theme}`)

    const QuestionIndex = await getModel("QuestionIndex")

    // Buscar todas as perguntas do tema
    const allQuestions = await QuestionIndex.find({
      index: theme,
    })
      .select("variable questionText label surveyNumber surveyName date")
      .sort({ variable: 1, surveyNumber: 1 })
      .lean()

    if (allQuestions.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Nenhuma pergunta encontrada para o tema '${theme}'`,
      })
    }

    // Função para extrair o código base da pergunta
    const getBaseQuestionCode = (variable) => {
      // Remove sufixos como #01, #02 ou _1, _2
      return variable.replace(/#\d+$/, '').replace(/_\d+$/, '')
    }

    // Função para verificar se é uma pergunta múltipla
    const isMultipleQuestion = (variable) => {
      return variable.includes('#') || /_\d+$/.test(variable)
    }

    // Primeiro, agrupar por questionText idêntico
    const textGroups = new Map()
    
    for (const question of allQuestions) {
      const key = question.questionText.trim()
      
      if (!textGroups.has(key)) {
        textGroups.set(key, [])
      }
      
      textGroups.get(key).push(question)
    }

    // Agora, processar cada grupo para identificar perguntas múltiplas
    const finalGroups = []
    const processedVariables = new Set()

    // Processar perguntas múltiplas primeiro
    for (const question of allQuestions) {
      if (processedVariables.has(question.variable)) continue

      const baseCode = getBaseQuestionCode(question.variable)
      
      if (isMultipleQuestion(question.variable)) {
        // Buscar todas as perguntas relacionadas com o mesmo código base
        const relatedQuestions = allQuestions.filter(q => {
          const qBaseCode = getBaseQuestionCode(q.variable)
          return qBaseCode === baseCode && 
                 q.surveyNumber === question.surveyNumber &&
                 !processedVariables.has(q.variable)
        })

        if (relatedQuestions.length > 1) {
          // É uma pergunta múltipla genuína
          const group = {
            id: `${theme}-multiple-${baseCode}-${question.surveyNumber}`,
            type: 'multiple',
            baseCode: baseCode,
            questionText: question.questionText,
            theme: theme,
            surveyNumber: question.surveyNumber,
            surveyName: question.surveyName,
            date: question.date,
            subQuestions: relatedQuestions.map(q => ({
              variable: q.variable,
              label: q.label || '',
              questionText: q.questionText,
              order: parseInt(q.variable.match(/#(\d+)$|_(\d+)$/)?.[1] || q.variable.match(/#(\d+)$|_(\d+)$/)?.[2] || '0')
            })).sort((a, b) => a.order - b.order),
            variables: relatedQuestions.map(q => q.variable),
            totalSubQuestions: relatedQuestions.length
          }

          finalGroups.push(group)
          relatedQuestions.forEach(q => processedVariables.add(q.variable))
        }
      }
    }

    // Agora processar as perguntas agrupadas por texto
    let groupIndex = 0
    for (const [questionText, questions] of textGroups.entries()) {
      // Filtrar perguntas já processadas
      const unprocessedQuestions = questions.filter(q => !processedVariables.has(q.variable))
      
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
          label: question.label || ''
        })
      }

      const group = {
        id: `${theme}-text-${groupIndex++}`,
        type: 'text-grouped',
        questionText: questionText,
        shortText: questionText.length > 200 ? questionText.substring(0, 200) + "..." : questionText,
        theme: theme,
        variables: Array.from(variables).sort(),
        rounds: Array.from(rounds).sort((a, b) => Number.parseInt(a) - Number.parseInt(b)),
        totalVariations: unprocessedQuestions.length,
        variations: variations.sort((a, b) => Number.parseInt(a.surveyNumber) - Number.parseInt(b.surveyNumber)),
        // Dados para usar no POST endpoint
        searchData: {
          theme: theme,
          questionText: questionText
        }
      }

      finalGroups.push(group)
      unprocessedQuestions.forEach(q => processedVariables.add(q.variable))
    }

    // Ordenar os grupos finais
    finalGroups.sort((a, b) => {
      // Primeiro por tipo (múltiplas primeiro)
      if (a.type !== b.type) {
        return a.type === 'multiple' ? -1 : 1
      }
      // Depois por código base ou texto
      if (a.type === 'multiple') {
        return a.baseCode.localeCompare(b.baseCode)
      }
      return a.questionText.localeCompare(b.questionText)
    })

    console.log(`✅ Encontrados ${finalGroups.length} grupos de perguntas para o tema '${theme}'`)

    // Estatísticas
    const multipleQuestions = finalGroups.filter(g => g.type === 'multiple')
    const textGroupedQuestions = finalGroups.filter(g => g.type === 'text-grouped')

    res.json({
      success: true,
      theme: theme,
      statistics: {
        totalGroups: finalGroups.length,
        multipleQuestions: multipleQuestions.length,
        textGroupedQuestions: textGroupedQuestions.length,
        totalQuestionsProcessed: processedVariables.size,
        totalQuestionsInTheme: allQuestions.length
      },
      questionGroups: finalGroups,
      usage: {
        message: "Use os dados em 'searchData' para buscar o histórico completo da pergunta",
        endpoint: "POST /api/data/question/grouped/responses",
        multipleQuestionsNote: "Para perguntas múltiplas, você pode buscar todas as subperguntas de uma vez usando o array 'variables'",
        example: {
          textGrouped: textGroupedQuestions.length > 0 ? {
            theme: theme,
            questionText: textGroupedQuestions[0].questionText
          } : null,
          multiple: multipleQuestions.length > 0 ? {
            theme: theme,
            variables: multipleQuestions[0].variables,
            baseCode: multipleQuestions[0].baseCode
          } : null
        }
      }
    })
  } catch (error) {
    console.error(`❌ Erro ao agrupar perguntas do tema:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
})



// GET /api/data/themes/:theme/questions-summary
// Resumo rápido das perguntas de um tema agrupadas
router.get("/themes/:theme/questions-summary", async (req, res) => {
  try {
    const { theme } = req.params
    console.log(`📊 Gerando resumo das perguntas do tema: ${theme}`)

    const QuestionIndex = await getModel("QuestionIndex")

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

    console.log(`✅ Resumo gerado: ${summary.length} grupos de perguntas`)

    res.json({
      success: true,
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
        endpoint: "POST /api/data/question/grouped/responses",
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
})

module.exports = router
