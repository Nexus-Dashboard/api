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

    // Criar mapeamento de datas por rodada
    const dateByRound = identicalQuestions.reduce((acc, q) => {
      if (!acc[q.surveyNumber] && q.date) {
        acc[q.surveyNumber] = q.date
      }
      return acc
    }, {})

    // Gera as duas formas da variável (P1 <-> P01) para tolerar divergência de
    // rotulação entre o índice (ex.: "P1" nas rodadas novas) e as respostas, que
    // são normalizadas para "P01" no upload do dashboard. Sem isso, rodadas com
    // rótulo divergente no índice somem do gráfico.
    const variableVariants = (v) => {
      const up = String(v).toUpperCase()
      const set = new Set([up])
      set.add(up.replace(/^P0+(\d)$/, "P$1")) // P01 -> P1
      set.add(up.replace(/^P(\d)$/, "P0$1")) // P1 -> P01
      return [...set]
    }

    // Criar filtro mais específico baseado nas combinações exatas rodada+variable
    const validCombinations = identicalQuestions.map((q) => ({
      variable: q.variable.toUpperCase(),
      variants: variableVariants(q.variable),
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
      "REGIAO",
      "PF1",
      "PF2_FAIXAS",
      "PF3",
      "PF4",
      "PF5",
      "PF6",
      "PF7",
      "PF8",
      "PF9",
      "PF10",
      "PF13",
      "PF15",
    ]

    // Buscar dados APENAS das combinações específicas que têm o texto exato.
    // Combinações com o mesmo conjunto de variantes são agrupadas numa única
    // consulta por banco (rodada: $in) — no caso típico (mesma variável em
    // todas as rodadas) isso reduz ~1 consulta por rodada para 1 por banco,
    // sem alterar o pareamento variante↔rodada: cada grupo só filtra answers
    // pelas variantes que valem para as suas próprias rodadas.
    const groupsByVariants = new Map()
    for (const combo of validCombinations) {
      const key = [...combo.variants].sort().join("|")
      if (!groupsByVariants.has(key)) {
        groupsByVariants.set(key, { variants: combo.variants, rodadas: [] })
      }
      const group = groupsByVariants.get(key)
      if (!group.rodadas.includes(combo.rodada)) {
        group.rodadas.push(combo.rodada)
      }
    }
    const queryGroups = [...groupsByVariants.values()]

    // Detectar padrão de faixa de renda (salário mínimo) para normalização PF15 → PF13
    const INCOME_PATTERN = /\((?:até|mais de|ate)\s+\d|SM\b/i

    // Fragmentos de $project compartilhados pelos pipelines
    const answersProjection = (group) => ({
      $filter: {
        input: "$answers",
        cond: { $in: ["$$this.k", group.variants] },
      },
    })

    const weightProjection = {
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
    }

    const demographicsProjection = {
      $arrayToObject: {
        $map: {
          input: { $filter: { input: "$answers", cond: { $in: ["$$this.k", demographicFields] } } },
          as: "item",
          in: { k: "$$item.k", v: "$$item.v" },
        },
      },
    }

    // Pipeline bruto (perguntas múltiplas): retorna uma linha por respondente
    const buildRawPipeline = (group) => [
      {
        $match: {
          "answers.k": { $in: group.variants },
          rodada: { $in: group.rodadas },
        },
      },
      {
        $project: {
          _id: 0,
          year: 1,
          rodada: 1,
          // Para perguntas múltiplas, precisamos capturar todas as respostas relevantes
          answers: answersProjection(group),
          weight: weightProjection,
          demographics: demographicsProjection,
        },
      },
      { $match: { answers: { $ne: [] } } },
    ]

    // Pipeline agregado (busca por texto, o caminho do dashboard): o $group
    // roda dentro do MongoDB e só as contagens cruzam a rede. Sem isso, uma
    // linha POR RESPONDENTE de todas as rodadas era transferida a cada
    // requisição (~200 mil documentos em temas de tracking) — essa
    // transferência era o principal gargalo do endpoint. O $facet produz as
    // contagens por resposta e as quebras demográficas num único scan da
    // coleção (dois pipelines separados dobrariam a leitura dos documentos).
    const buildTextPipeline = (group) => [
      {
        $match: {
          "answers.k": { $in: group.variants },
          rodada: { $in: group.rodadas },
        },
      },
      {
        $project: {
          _id: 0,
          year: 1,
          rodada: 1,
          answers: answersProjection(group),
          weight: weightProjection,
          demographics: demographicsProjection,
        },
      },
      { $match: { answers: { $ne: [] } } },
      { $addFields: { mainAnswer: { $arrayElemAt: ["$answers.v", 0] } } },
      {
        $facet: {
          // Uma linha por (rodada, resposta); respostas vazias/nulas entram
          // nos totais da rodada, como no processamento anterior em JS
          answerCounts: [
            {
              $group: {
                _id: { year: "$year", rodada: "$rodada", answer: "$mainAnswer" },
                count: { $sum: 1 },
                weightedCount: { $sum: "$weight" },
              },
            },
          ],
          demographicCounts: [
            { $match: { mainAnswer: { $nin: [null, ""] } } },
            {
              // Normalização PF15 → PF13 (faixa de renda), espelhando normalizeDemographics
              $addFields: {
                demographics: {
                  $cond: [
                    {
                      $regexMatch: {
                        input: { $toString: { $ifNull: ["$demographics.PF13", ""] } },
                        regex: INCOME_PATTERN,
                      },
                    },
                    "$demographics",
                    {
                      $cond: [
                        {
                          $regexMatch: {
                            input: { $toString: { $ifNull: ["$demographics.PF15", ""] } },
                            regex: INCOME_PATTERN,
                          },
                        },
                        {
                          $mergeObjects: [
                            {
                              $arrayToObject: {
                                $filter: {
                                  input: { $objectToArray: "$demographics" },
                                  cond: { $ne: ["$$this.k", "PF15"] },
                                },
                              },
                            },
                            { PF13: "$demographics.PF15" },
                          ],
                        },
                        "$demographics",
                      ],
                    },
                  ],
                },
              },
            },
            { $addFields: { demoArray: { $objectToArray: "$demographics" } } },
            { $unwind: "$demoArray" },
            { $match: { "demoArray.v": { $nin: [null, ""] } } },
            {
              $group: {
                _id: {
                  year: "$year",
                  rodada: "$rodada",
                  answer: "$mainAnswer",
                  field: "$demoArray.k",
                  value: "$demoArray.v",
                },
                count: { $sum: 1 },
                weightedCount: { $sum: "$weight" },
              },
            },
          ],
        },
      },
    ]

    // As agregações (banco × grupo × pipeline) são independentes entre si —
    // executar em paralelo com concorrência limitada em vez de uma a uma. Os
    // resultados são gravados por índice para manter o processamento
    // determinístico.
    const tasks = []
    for (const Response of responseModels) {
      for (const group of queryGroups) {
        if (searchType === "text") {
          tasks.push({ Response, kind: "text", pipeline: buildTextPipeline(group) })
        } else {
          tasks.push({ Response, kind: "raw", pipeline: buildRawPipeline(group) })
        }
      }
    }
    console.log(
      `🔍 Processando ${tasks.length} agregações (${queryGroups.length} grupo(s) de variantes × ${responseModels.length} banco(s)) [${dbKey}]`,
    )

    const CONCURRENCY = 8
    const resultsByTask = new Array(tasks.length)
    let nextTaskIndex = 0
    const workers = Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
      while (nextTaskIndex < tasks.length) {
        const index = nextTaskIndex++
        const { Response, pipeline, kind } = tasks[index]
        const startedAt = Date.now()
        resultsByTask[index] = await Response.aggregate(pipeline, {
          allowDiskUse: true,
          maxTimeMS: 60000,
        })
        const rowCount =
          kind === "text"
            ? (resultsByTask[index][0]?.answerCounts?.length || 0) +
              (resultsByTask[index][0]?.demographicCounts?.length || 0)
            : resultsByTask[index].length
        console.log(
          `⏱️  [${Response.db.name}] agregação ${index + 1}/${tasks.length} (${kind}): ${rowCount} linhas em ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        )
      }
    })
    await Promise.all(workers)

    // push individual: spread (push(...results)) estoura a pilha com
    // dezenas de milhares de documentos num único array de resultados
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].kind !== "raw") continue
      for (const doc of resultsByTask[i]) {
        rawData.push(doc)
      }
    }

    const normalizeDemographics = (demographics) => {
      // Se já tem PF13 com valores de faixa de renda, não precisa normalizar
      if (demographics.PF13 && INCOME_PATTERN.test(demographics.PF13)) {
        return demographics
      }
      // Se PF15 tem valores de faixa de renda, promovê-lo para PF13
      if (demographics.PF15 && INCOME_PATTERN.test(demographics.PF15)) {
        const normalized = { ...demographics, PF13: demographics.PF15 }
        delete normalized.PF15
        return normalized
      }
      return demographics
    }

    // Montar os dados por rodada
    const processedData = new Map()

    const ensureRound = (year, rodada) => {
      const roundKey = `${year}-R${rodada}`
      if (!processedData.has(roundKey)) {
        processedData.set(roundKey, {
          year: year,
          rodada: rodada,
          period: roundKey,
          date: dateByRound[rodada.toString()] || null,
          variables: variablesByRound[rodada.toString()] || [],
          totalResponses: 0,
          totalWeightedResponses: 0,
          distribution: searchType === "multiple" ? {} : new Map(),
        })
      }
      return processedData.get(roundKey)
    }

    if (searchType === "text") {
      // As contagens já vêm agregadas do MongoDB — aqui só remontamos a
      // estrutura por rodada, com a mesma semântica do processamento antigo.
      // 1ª passada: totais e distribuição por resposta
      for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].kind !== "text") continue
        for (const row of resultsByTask[i][0]?.answerCounts || []) {
          const { year, rodada, answer } = row._id
          const roundData = ensureRound(year, rodada)
          roundData.totalResponses += row.count
          roundData.totalWeightedResponses += row.weightedCount

          // Respostas vazias contam nos totais, mas não entram na distribuição
          if (!answer) continue
          if (!roundData.distribution.has(answer)) {
            roundData.distribution.set(answer, {
              response: answer,
              count: 0,
              weightedCount: 0,
              demographics: {},
            })
          }
          const answerData = roundData.distribution.get(answer)
          answerData.count += row.count
          answerData.weightedCount += row.weightedCount
        }
      }

      // 2ª passada: quebras demográficas por resposta
      for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].kind !== "text") continue
        for (const row of resultsByTask[i][0]?.demographicCounts || []) {
          const { year, rodada, answer, field, value } = row._id
          if (!answer || !value) continue
          const roundData = processedData.get(`${year}-R${rodada}`)
          if (!roundData) continue
          const answerData = roundData.distribution.get(answer)
          if (!answerData) continue

          if (!answerData.demographics[field]) {
            answerData.demographics[field] = new Map()
          }
          const demoFieldMap = answerData.demographics[field]
          if (!demoFieldMap.has(value)) {
            demoFieldMap.set(value, { response: value, count: 0, weightedCount: 0 })
          }
          const demoValueData = demoFieldMap.get(value)
          demoValueData.count += row.count
          demoValueData.weightedCount += row.weightedCount
        }
      }
    } else {
      console.log(`📊 Total de registros brutos coletados: ${rawData.length}`)

      for (const doc of rawData) {
        doc.demographics = normalizeDemographics(doc.demographics)
        const roundData = ensureRound(doc.year, doc.rodada)
        roundData.totalResponses += 1
        roundData.totalWeightedResponses += doc.weight

        // Para perguntas múltiplas, processar cada resposta separadamente
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
      }
    }

    // Verificar se temos dados apenas das rodadas corretas
    const foundRounds = [...new Set([...processedData.values()].map((r) => r.rodada.toString()))]
    console.log(`📊 Rodadas encontradas nos dados: ${foundRounds.join(", ")}`)
    console.log(`📊 Rodadas esperadas: ${surveyNumbers.join(", ")}`)

    // Verificar se há rodadas extras (não deveria haver mais com a correção)
    const extraRounds = foundRounds.filter((round) => !surveyNumbers.includes(round))
    if (extraRounds.length > 0) {
      console.warn(`⚠️ AVISO: Ainda encontradas rodadas extras: ${extraRounds.join(", ")} - isso não deveria acontecer`)
    }

    if (processedData.size === 0) {
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
