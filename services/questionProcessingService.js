// services/questionProcessingService.js
const { getModel, getAllModels } = require("../config/dbManager")

// Função auxiliar para processar pergunta específica
async function processSpecificQuestion(questionInfo, questionCodeDecoded, theme, dbKey = "telephonic") {
  console.log(`📋 Pergunta encontrada: ${questionInfo.questionText.substring(0, 100)}...`)
  console.log(`📋 Rodada da pergunta: ${questionInfo.surveyNumber}`)

  // Buscar APENAS perguntas que tenham exatamente o mesmo questionText, variable E index (tema)
  const QuestionIndex = await getModel("QuestionIndex", dbKey)
  const identicalQuestions = await QuestionIndex.find({
    questionText: questionInfo.questionText,
    variable: questionCodeDecoded,
    index: questionInfo.index, // Usar o index da pergunta encontrada
  }).lean()

  const questionCodes = identicalQuestions.map((q) => q.variable.toUpperCase())
  const surveyNumbers = identicalQuestions.map((q) => q.surveyNumber)

  console.log(`📋 Perguntas idênticas encontradas: ${questionCodes.join(", ")}`)
  console.log(`📋 Rodadas correspondentes: ${surveyNumbers.join(", ")}`)

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

  // Buscar dados apenas das rodadas específicas
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

  // Processar dados
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

module.exports = {
  processSpecificQuestion,
}
