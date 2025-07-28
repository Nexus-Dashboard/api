// controllers/responsesController.js
const { getModel, getAllModels } = require("../config/dbManager")

// POST /api/data/question/grouped/responses?type=f2f
const getGroupedResponses = async (req, res) => {
  try {
    const dbKey = req.dbKey
    const { theme, questionText, variables, baseCode } = req.body

    console.log(`🎯 [${dbKey}] Recebida requisição para respostas agrupadas:`)
    console.log(`   📋 Theme: ${theme}`)
    console.log(`   📋 QuestionText: ${questionText ? questionText.substring(0, 100) + "..." : "não fornecido"}`)
    console.log(`   📋 Variables: ${variables ? variables.join(", ") : "não fornecido"}`)
    console.log(`   📋 BaseCode: ${baseCode || "não fornecido"}`)

    // Validações
    if (!theme) {
      return res.status(400).json({
        success: false,
        message: "Campo 'theme' é obrigatório no body da requisição",
        receivedBody: req.body,
      })
    }

    if (!questionText && (!variables || variables.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "É necessário fornecer 'questionText' ou 'variables' no body da requisição",
        receivedBody: req.body,
      })
    }

    const QuestionIndex = await getModel("QuestionIndex", dbKey)
    let identicalQuestions = []
    let searchType = ""

    if (variables && variables.length > 0) {
      console.log(`⚡️ Busca por perguntas múltiplas em [${dbKey}]: ${variables.join(", ")} no tema: ${theme}`)
      searchType = "multiple"
      identicalQuestions = await QuestionIndex.find({
        index: theme,
        variable: { $in: variables },
      }).lean()
    } else if (questionText) {
      console.log(`⚡️ Busca agrupada para pergunta em [${dbKey}] no tema: ${theme}`)
      console.log(`📋 Texto da pergunta: ${questionText.substring(0, 100)}...`)
      searchType = "text"
      const exactQuestionText = questionText.trim()

      // Primeiro, tentar busca exata
      identicalQuestions = await QuestionIndex.find({
        index: theme,
        questionText: { $eq: exactQuestionText },
      }).lean()

      console.log(`🔍 Busca exata encontrou: ${identicalQuestions.length} perguntas`)

      // Se não encontrou com busca exata, tentar busca por regex (mais flexível)
      if (identicalQuestions.length === 0) {
        console.log(`🔍 Tentando busca por regex...`)
        const escapedText = exactQuestionText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        identicalQuestions = await QuestionIndex.find({
          index: theme,
          questionText: { $regex: escapedText, $options: "i" },
        }).lean()
        console.log(`🔍 Busca por regex encontrou: ${identicalQuestions.length} perguntas`)
      }

      // Se ainda não encontrou, buscar apenas por tema para debug
      if (identicalQuestions.length === 0) {
        console.log(`🔍 Debug: Buscando todas as perguntas do tema '${theme}'...`)
        const allQuestionsInTheme = await QuestionIndex.find({ index: theme })
          .select("variable questionText")
          .limit(5)
          .lean()

        console.log(`📊 Primeiras 5 perguntas do tema '${theme}':`)
        allQuestionsInTheme.forEach((q, index) => {
          console.log(`   ${index + 1}. ${q.variable}: ${q.questionText.substring(0, 80)}...`)
        })
      }
    }

    if (identicalQuestions.length === 0) {
      // Buscar informações de debug
      const themeExists = await QuestionIndex.findOne({ index: theme }).lean()
      const totalQuestionsInTheme = await QuestionIndex.countDocuments({ index: theme })

      return res.status(404).json({
        success: false,
        type: dbKey,
        message:
          searchType === "multiple"
            ? `Nenhuma pergunta encontrada com as variáveis fornecidas no tema '${theme}' para o tipo '${dbKey}'.`
            : `Nenhuma pergunta encontrada com o texto fornecido no tema '${theme}' para o tipo '${dbKey}'.`,
        searchDetails: {
          theme: theme,
          themeExists: !!themeExists,
          totalQuestionsInTheme: totalQuestionsInTheme,
          searchType: searchType,
          questionText: searchType === "text" ? questionText.substring(0, 200) + "..." : null,
          variables: searchType === "multiple" ? variables : null,
        },
        debug: {
          receivedBody: req.body,
          dbKey: dbKey,
        },
      })
    }

    // Validação adicional para busca por texto
    if (searchType === "text") {
      const uniqueQuestionTexts = [...new Set(identicalQuestions.map((q) => q.questionText))]
      if (uniqueQuestionTexts.length > 1) {
        console.error(`❌ ERRO: Encontrados ${uniqueQuestionTexts.length} textos diferentes na busca por texto`)
        return res.status(400).json({
          success: false,
          type: dbKey,
          message: `Erro interno: busca por texto retornou ${uniqueQuestionTexts.length} textos diferentes`,
          foundTexts: uniqueQuestionTexts.map((text) => text.substring(0, 100) + "..."),
        })
      }
    }

    console.log(`✅ Encontradas ${identicalQuestions.length} variações da pergunta em [${dbKey}]`)

    // Extrair todas as variáveis e rodadas
    const questionCodes = [...new Set(identicalQuestions.map((q) => q.variable.toUpperCase()))]
    const surveyNumbers = [...new Set(identicalQuestions.map((q) => q.surveyNumber))]
    const variablesByRound = identicalQuestions.reduce((acc, q) => {
      if (!acc[q.surveyNumber]) acc[q.surveyNumber] = []
      if (!acc[q.surveyNumber].includes(q.variable)) {
        acc[q.surveyNumber].push(q.variable)
      }
      return acc
    }, {})

    // Criar filtro mais específico baseado nas combinações exatas rodada+variable
    const validCombinations = identicalQuestions.map((q) => ({
      variable: q.variable.toUpperCase(),
      rodada: Number.parseInt(q.surveyNumber),
      questionText: q.questionText,
    }))

    console.log(`📋 Variáveis únicas encontradas: ${questionCodes.join(", ")}`)
    console.log(`📋 Rodadas correspondentes: ${surveyNumbers.join(", ")}`)
    console.log(`📋 Total de rodadas válidas: ${surveyNumbers.length}`)
    console.log(`📋 Combinações válidas rodada+variable: ${validCombinations.length}`)

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

    // Buscar dados APENAS das combinações específicas que têm o texto exato
    for (const Response of responseModels) {
      console.log(`🔍 Processando banco [${dbKey}]: ${Response.db.name}`)

      // Buscar dados apenas para as combinações válidas
      for (const combo of validCombinations) {
        const pipeline = [
          {
            $match: {
              "answers.k": combo.variable,
              rodada: combo.rodada,
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
                  cond: { $eq: ["$$this.k", combo.variable] },
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
          { $match: { answers: { $ne: [] } } },
        ]

        const results = await Response.aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 30000 })
        rawData.push(...results)
      }

      console.log(`📊 Total registros coletados até agora: ${rawData.length}`)
    }

    console.log(`📊 Total de registros brutos coletados: ${rawData.length}`)

    // Verificar se temos dados apenas das rodadas corretas
    const foundRounds = [...new Set(rawData.map((doc) => doc.rodada.toString()))]
    console.log(`📊 Rodadas encontradas nos dados: ${foundRounds.join(", ")}`)
    console.log(`📊 Rodadas esperadas: ${surveyNumbers.join(", ")}`)

    // Verificar se há rodadas extras (não deveria haver mais com a correção)
    const extraRounds = foundRounds.filter((round) => !surveyNumbers.includes(round))
    if (extraRounds.length > 0) {
      console.warn(`⚠️ AVISO: Ainda encontradas rodadas extras: ${extraRounds.join(", ")} - isso não deveria acontecer`)
    }

    if (rawData.length === 0) {
      return res.json({
        success: true,
        type: dbKey,
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
          distribution: searchType === "multiple" ? {} : new Map(),
        })
      }
      const roundData = processedData.get(roundKey)
      roundData.totalResponses += 1
      roundData.totalWeightedResponses += doc.weight

      // Para perguntas múltiplas, processar cada resposta separadamente
      if (searchType === "multiple") {
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
        if (searchType === "multiple") {
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
    if (searchType === "multiple") {
      labelsInfo = identicalQuestions.reduce((acc, q) => {
        acc[q.variable] = q.label || q.questionText
        return acc
      }, {})
    }

    const response = {
      success: true,
      type: dbKey,
      searchMethod: searchType === "multiple" ? "Perguntas múltiplas" : "Agrupado por questionText + theme",
      searchType: searchType,
      theme: theme,
      questionText: questionText || null,
      baseCode: baseCode || null,
      questionInfo: {
        variables: questionCodes,
        rounds: surveyNumbers,
        totalVariations: identicalQuestions.length,
        variablesByRound: variablesByRound,
        labels: labelsInfo,
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

    console.log(`✅ Resposta agrupada enviada para [${dbKey}]: ${finalHistoricalData.length} rodadas com dados`)
    res.json(response)
  } catch (error) {
    console.error(`❌ Erro na busca agrupada:`, error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
      stack: process.env.NODE_ENV !== "production" ? error.stack : undefined,
    })
  }
}

module.exports = {
  getGroupedResponses,
}
