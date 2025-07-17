// routes/maintenanceRoutes.js
const express = require("express")
const router = express.Router()
const mongoose = require("mongoose")
const { getAllModels } = require("../config/dbManager")

// DELETE /api/maintenance/cleanup-old-responses
// Remove respostas antigas de um período específico
router.delete("/cleanup-old-responses", async (req, res) => {
  try {
    const { startDate, endDate } = req.query

    // Se não fornecidas as datas, usar as datas padrão do problema
    const defaultStartDate = "2025-04-20T15:00:00Z"
    const defaultEndDate = "2025-04-20T16:00:00Z"

    const start = startDate ? new Date(startDate) : new Date(defaultStartDate)
    const end = endDate ? new Date(endDate) : new Date(defaultEndDate)

    console.log(`🗑️ Iniciando limpeza de respostas antigas entre ${start.toISOString()} e ${end.toISOString()}`)

    // Usar getAllModels para acessar todos os bancos
    const responseModels = getAllModels("Response")
    let totalDeleted = 0

    for (const Response of responseModels) {
      const dbName = Response.db.name
      console.log(`  🗑️ Limpando banco: ${dbName}`)

      const countToDelete = await Response.countDocuments({
        createdAt: {
          $gte: start,
          $lt: end,
        },
      })

      if (countToDelete > 0) {
        const deleteResult = await Response.deleteMany({
          createdAt: {
            $gte: start,
            $lt: end,
          },
        })
        totalDeleted += deleteResult.deletedCount
        console.log(`    ✅ ${deleteResult.deletedCount} respostas removidas do banco ${dbName}`)
      }
    }

    if (totalDeleted === 0) {
      return res.json({
        success: true,
        message: "Nenhuma resposta encontrada no período especificado.",
        deletedCount: 0,
      })
    }

    console.log(`✅ Deleção concluída: ${totalDeleted} respostas removidas no total`)

    res.json({
      success: true,
      message: `Limpeza concluída com sucesso!`,
      deletedCount: totalDeleted,
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    })
  } catch (error) {
    console.error("Erro durante a limpeza de respostas antigas:", error)
    res.status(500).json({
      success: false,
      error: "Erro interno no servidor durante a limpeza.",
      details: error.message,
    })
  }
})

// GET /api/maintenance/stats
// Mostra estatísticas do banco de dados
router.get("/stats", async (req, res) => {
  try {
    const responseModels = getAllModels("Response")
    const surveyModels = getAllModels("Survey")
    const questionModels = getAllModels("QuestionIndex")

    let totalResponses = 0
    let totalSurveys = 0
    let totalQuestions = 0
    const responsesByYear = []
    const responsesByRodada = []

    // Contar em todos os bancos
    for (const Response of responseModels) {
      const count = await Response.countDocuments()
      totalResponses += count

      // Estatísticas por ano para este banco
      const yearStats = await Response.aggregate([
        {
          $group: {
            _id: "$year",
            count: { $sum: 1 },
          },
        },
        {
          $sort: { _id: -1 },
        },
      ])
      responsesByYear.push(...yearStats)

      // Estatísticas por rodada para este banco
      const rodadaStats = await Response.aggregate([
        {
          $group: {
            _id: { year: "$year", rodada: "$rodada" },
            count: { $sum: 1 },
          },
        },
        {
          $sort: { "_id.year": -1, "_id.rodada": -1 },
        },
        {
          $limit: 10,
        },
      ])
      responsesByRodada.push(...rodadaStats)
    }

    for (const Survey of surveyModels) {
      const count = await Survey.countDocuments()
      totalSurveys += count
    }

    for (const QuestionIndex of questionModels) {
      const count = await QuestionIndex.countDocuments()
      totalQuestions += count
    }

    res.json({
      success: true,
      stats: {
        totalResponses,
        totalSurveys,
        totalQuestions,
        responsesByYear,
        recentRodadas: responsesByRodada.slice(0, 10),
      },
    })
  } catch (error) {
    console.error("Erro ao buscar estatísticas:", error)
    res.status(500).json({
      success: false,
      error: "Erro ao buscar estatísticas do banco.",
      details: error.message,
    })
  }
})

// DELETE /api/maintenance/cleanup-by-date-range
// Versão mais flexível para deletar por qualquer período
router.delete("/cleanup-by-date-range", async (req, res) => {
  try {
    const { startDate, endDate, dryRun } = req.body

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "startDate e endDate são obrigatórios.",
      })
    }

    const start = new Date(startDate)
    const end = new Date(endDate)

    if (start >= end) {
      return res.status(400).json({
        success: false,
        error: "startDate deve ser anterior a endDate.",
      })
    }

    console.log(`🔍 Analisando respostas entre ${start.toISOString()} e ${end.toISOString()}`)

    const responseModels = getAllModels("Response")
    let totalCount = 0
    let totalDeleted = 0

    for (const Response of responseModels) {
      const dbName = Response.db.name
      console.log(`  📊 Analisando banco: ${dbName}`)

      const countToDelete = await Response.countDocuments({
        createdAt: {
          $gte: start,
          $lt: end,
        },
      })

      totalCount += countToDelete

      if (!dryRun && countToDelete > 0) {
        const deleteResult = await Response.deleteMany({
          createdAt: {
            $gte: start,
            $lt: end,
          },
        })
        totalDeleted += deleteResult.deletedCount
        console.log(`    ✅ ${deleteResult.deletedCount} respostas removidas do banco ${dbName}`)
      }
    }

    // Se for dry run, apenas retorna a contagem
    if (dryRun) {
      return res.json({
        success: true,
        message: "Simulação executada (nenhuma deleção realizada).",
        wouldDeleteCount: totalCount,
        period: {
          start: start.toISOString(),
          end: end.toISOString(),
        },
      })
    }

    if (totalCount === 0) {
      return res.json({
        success: true,
        message: "Nenhuma resposta encontrada no período especificado.",
        deletedCount: 0,
      })
    }

    console.log(`✅ Deleção concluída: ${totalDeleted} respostas removidas no total`)

    res.json({
      success: true,
      message: `Limpeza concluída com sucesso!`,
      deletedCount: totalDeleted,
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    })
  } catch (error) {
    console.error("Erro durante a limpeza por período:", error)
    res.status(500).json({
      success: false,
      error: "Erro interno no servidor durante a limpeza.",
      details: error.message,
    })
  }
})

// DELETE /api/maintenance/cleanup-before-date
// Remove todas as respostas anteriores ou iguais a uma data específica
router.delete("/cleanup-before-date", async (req, res) => {
  try {
    const { beforeDate, dryRun } = req.query

    // Data padrão: 30/06/2025
    const defaultDate = "2025-06-30T23:59:59Z"
    const cutoffDate = beforeDate ? new Date(beforeDate) : new Date(defaultDate)

    console.log(`🗑️ Iniciando limpeza de respostas anteriores ou iguais a ${cutoffDate.toISOString()}`)

    const responseModels = getAllModels("Response")
    let totalCount = 0
    let totalDeleted = 0

    for (const Response of responseModels) {
      const dbName = Response.db.name
      console.log(`  📊 Analisando banco: ${dbName}`)

      const countToDelete = await Response.countDocuments({
        createdAt: {
          $lte: cutoffDate,
        },
      })

      totalCount += countToDelete
      console.log(`    📊 Encontradas ${countToDelete} respostas no banco ${dbName}`)

      if (dryRun !== "true" && countToDelete > 0) {
        // Executar a deleção em lotes para evitar timeout
        const batchSize = 1000
        let deletedInThisDb = 0

        while (true) {
          const docsToDelete = await Response.find({ createdAt: { $lte: cutoffDate } })
            .select("_id")
            .limit(batchSize)
            .lean()

          if (docsToDelete.length === 0) break

          const idsToDelete = docsToDelete.map((doc) => doc._id)
          const deleteResult = await Response.deleteMany({ _id: { $in: idsToDelete } })

          deletedInThisDb += deleteResult.deletedCount
          console.log(
            `    🔄 Deletadas ${deleteResult.deletedCount} respostas do banco ${dbName} (total: ${deletedInThisDb})`,
          )

          if (deleteResult.deletedCount < batchSize) {
            break
          }
        }
        totalDeleted += deletedInThisDb
      }
    }

    // Se for dry run, apenas retorna a contagem
    if (dryRun === "true") {
      return res.json({
        success: true,
        message: "Simulação executada (nenhuma deleção realizada).",
        wouldDeleteCount: totalCount,
        cutoffDate: cutoffDate.toISOString(),
      })
    }

    if (totalCount === 0) {
      return res.json({
        success: true,
        message: "Nenhuma resposta encontrada anterior à data especificada.",
        deletedCount: 0,
      })
    }

    console.log(`✅ Limpeza concluída: ${totalDeleted} respostas removidas no total`)

    res.json({
      success: true,
      message: `Limpeza concluída com sucesso!`,
      deletedCount: totalDeleted,
      cutoffDate: cutoffDate.toISOString(),
    })
  } catch (error) {
    console.error("Erro durante a limpeza por data:", error)
    res.status(500).json({
      success: false,
      error: "Erro interno no servidor durante a limpeza.",
      details: error.message,
    })
  }
})

// DELETE /api/maintenance/cleanup-june-2025
// Rota específica para limpar dados até 30/06/2025 (mais rápida)
router.delete("/cleanup-june-2025", async (req, res) => {
  try {
    const cutoffDate = new Date("2025-06-30T23:59:59Z")
    console.log(`🗑️ Limpeza específica: removendo todas as respostas até ${cutoffDate.toISOString()}`)

    const responseModels = getAllModels("Response")
    let totalCount = 0
    let totalDeleted = 0

    for (const Response of responseModels) {
      const dbName = Response.db.name
      console.log(`  📊 Processando banco: ${dbName}`)

      const countToDelete = await Response.countDocuments({
        createdAt: { $lte: cutoffDate },
      })

      totalCount += countToDelete

      if (countToDelete > 0) {
        console.log(`    📊 ${countToDelete} respostas serão removidas do banco ${dbName}`)

        // Deletar em lotes para performance
        let deletedInThisDb = 0
        const batchSize = 2000

        while (deletedInThisDb < countToDelete) {
          const docsToDelete = await Response.find({ createdAt: { $lte: cutoffDate } })
            .select("_id")
            .limit(batchSize)
            .lean()

          if (docsToDelete.length === 0) break

          const idsToDelete = docsToDelete.map((doc) => doc._id)
          const result = await Response.deleteMany({ _id: { $in: idsToDelete } })

          deletedInThisDb += result.deletedCount
          console.log(`    🔄 Progresso banco ${dbName}: ${deletedInThisDb}/${countToDelete} respostas removidas`)

          if (result.deletedCount === 0) break
        }
        totalDeleted += deletedInThisDb
      }
    }

    if (totalCount === 0) {
      return res.json({
        success: true,
        message: "Nenhuma resposta encontrada até 30/06/2025.",
        deletedCount: 0,
      })
    }

    console.log(`✅ Limpeza de junho/2025 concluída: ${totalDeleted} respostas removidas no total`)

    res.json({
      success: true,
      message: "Limpeza de dados até 30/06/2025 concluída!",
      deletedCount: totalDeleted,
      cutoffDate: cutoffDate.toISOString(),
    })
  } catch (error) {
    console.error("Erro na limpeza de junho/2025:", error)
    res.status(500).json({
      success: false,
      error: "Erro durante a limpeza de junho/2025.",
      details: error.message,
    })
  }
})

// POST /api/maintenance/optimize
// Otimiza o banco removendo duplicatas e reorganizando
router.post("/optimize", async (req, res) => {
  try {
    console.log("🔧 Iniciando otimização do banco de dados...")

    const responseModels = getAllModels("Response")
    let totalDuplicatesRemoved = 0
    let finalTotalResponses = 0

    for (const Response of responseModels) {
      const dbName = Response.db.name
      console.log(`  🔧 Otimizando banco: ${dbName}`)

      // 1. Remover respostas duplicadas (mesmo surveyId + entrevistadoId)
      const duplicates = await Response.aggregate([
        {
          $group: {
            _id: { surveyId: "$surveyId", entrevistadoId: "$entrevistadoId" },
            count: { $sum: 1 },
            docs: { $push: "$_id" },
          },
        },
        {
          $match: { count: { $gt: 1 } },
        },
      ])

      let duplicatesRemovedInThisDb = 0
      for (const duplicate of duplicates) {
        // Manter apenas o primeiro documento, remover os outros
        const docsToRemove = duplicate.docs.slice(1)
        await Response.deleteMany({ _id: { $in: docsToRemove } })
        duplicatesRemovedInThisDb += docsToRemove.length
      }

      totalDuplicatesRemoved += duplicatesRemovedInThisDb
      console.log(`    🗑️ Removidas ${duplicatesRemovedInThisDb} respostas duplicadas do banco ${dbName}`)

      // Contar respostas finais neste banco
      const finalCount = await Response.countDocuments()
      finalTotalResponses += finalCount
    }

    console.log(`✅ Otimização concluída: ${totalDuplicatesRemoved} duplicatas removidas no total`)

    res.json({
      success: true,
      message: "Otimização concluída com sucesso!",
      duplicatesRemoved: totalDuplicatesRemoved,
      totalResponsesAfterOptimization: finalTotalResponses,
    })
  } catch (error) {
    console.error("Erro durante a otimização:", error)
    res.status(500).json({
      success: false,
      error: "Erro interno no servidor durante a otimização.",
      details: error.message,
    })
  }
})

// DELETE /api/maintenance/reset-database
// DELETA TODOS OS DADOS DE TODAS AS COLEÇÕES EM TODOS OS BANCOS
router.delete("/reset-database", async (req, res) => {
  try {
    console.log("🔥 ATENÇÃO: Iniciando a limpeza completa de TODOS os bancos de dados...")

    const modelNames = ["Response", "Survey", "QuestionIndex"]
    let totalDeleted = 0

    for (const modelName of modelNames) {
      const modelInstances = getAllModels(modelName)
      for (const Model of modelInstances) {
        const dbName = Model.db.name
        console.log(`- Limpando coleção ${modelName} do banco ${dbName}...`)
        const result = await Model.deleteMany({})
        console.log(`  ... ${result.deletedCount} documentos removidos.`)
        totalDeleted += result.deletedCount
      }
    }

    console.log("✅ Limpeza completa finalizada!")
    res.status(200).json({
      success: true,
      message: "Todos os dados foram removidos de todos os bancos de dados com sucesso!",
      totalDocumentsDeleted: totalDeleted,
    })
  } catch (error) {
    console.error("Erro crítico durante a limpeza completa do banco de dados:", error)
    res.status(500).json({
      success: false,
      error: "Erro interno no servidor durante a limpeza.",
      details: error.message,
    })
  }
})

module.exports = router
