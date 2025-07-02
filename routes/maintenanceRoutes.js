// routes/maintenanceRoutes.js
const express = require("express")
const router = express.Router()
const mongoose = require("mongoose")
const connectDB = require("../config/db")
const Response = require("../models/Response")
const Survey = require("../models/Survey")
const QuestionIndex = require("../models/QuestionIndex")
const { getAllModels } = require("../config/dbManager")

// DELETE /api/maintenance/cleanup-old-responses
// Remove respostas antigas de um período específico
router.delete("/cleanup-old-responses", async (req, res) => {
  try {
    await connectDB()

    const { startDate, endDate } = req.query

    // Se não fornecidas as datas, usar as datas padrão do problema
    const defaultStartDate = "2025-04-20T15:00:00Z"
    const defaultEndDate = "2025-04-20T16:00:00Z"

    const start = startDate ? new Date(startDate) : new Date(defaultStartDate)
    const end = endDate ? new Date(endDate) : new Date(defaultEndDate)

    console.log(`🗑️ Iniciando limpeza de respostas antigas entre ${start.toISOString()} e ${end.toISOString()}`)

    // Primeiro, contar quantas respostas serão deletadas
    const countToDelete = await Response.countDocuments({
      createdAt: {
        $gte: start,
        $lt: end,
      },
    })

    if (countToDelete === 0) {
      return res.json({
        success: true,
        message: "Nenhuma resposta encontrada no período especificado.",
        deletedCount: 0,
      })
    }

    console.log(`📊 Encontradas ${countToDelete} respostas para deletar`)

    // Executar a deleção
    const deleteResult = await Response.deleteMany({
      createdAt: {
        $gte: start,
        $lt: end,
      },
    })

    console.log(`✅ Deleção concluída: ${deleteResult.deletedCount} respostas removidas`)

    res.json({
      success: true,
      message: `Limpeza concluída com sucesso!`,
      deletedCount: deleteResult.deletedCount,
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
    await connectDB()

    const [responsesCount, surveysCount, questionsCount] = await Promise.all([
      Response.countDocuments(),
      Survey.countDocuments(),
      QuestionIndex.countDocuments(),
    ])

    // Estatísticas por ano
    const responsesByYear = await Response.aggregate([
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

    // Estatísticas por rodada (últimas 10)
    const responsesByRodada = await Response.aggregate([
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

    res.json({
      success: true,
      stats: {
        totalResponses: responsesCount,
        totalSurveys: surveysCount,
        totalQuestions: questionsCount,
        responsesByYear,
        recentRodadas: responsesByRodada,
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
    await connectDB()

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

    // Contar quantas respostas serão afetadas
    const countToDelete = await Response.countDocuments({
      createdAt: {
        $gte: start,
        $lt: end,
      },
    })

    // Se for dry run, apenas retorna a contagem
    if (dryRun) {
      return res.json({
        success: true,
        message: "Simulação executada (nenhuma deleção realizada).",
        wouldDeleteCount: countToDelete,
        period: {
          start: start.toISOString(),
          end: end.toISOString(),
        },
      })
    }

    if (countToDelete === 0) {
      return res.json({
        success: true,
        message: "Nenhuma resposta encontrada no período especificado.",
        deletedCount: 0,
      })
    }

    // Executar a deleção
    const deleteResult = await Response.deleteMany({
      createdAt: {
        $gte: start,
        $lt: end,
      },
    })

    console.log(`✅ Deleção concluída: ${deleteResult.deletedCount} respostas removidas`)

    res.json({
      success: true,
      message: `Limpeza concluída com sucesso!`,
      deletedCount: deleteResult.deletedCount,
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
    await connectDB()

    const { beforeDate, dryRun } = req.query

    // Data padrão: 30/06/2025
    const defaultDate = "2025-06-30T23:59:59Z"
    const cutoffDate = beforeDate ? new Date(beforeDate) : new Date(defaultDate)

    console.log(`🗑️ Iniciando limpeza de respostas anteriores ou iguais a ${cutoffDate.toISOString()}`)

    // Primeiro, contar quantas respostas serão deletadas
    const countToDelete = await Response.countDocuments({
      createdAt: {
        $lte: cutoffDate,
      },
    })

    if (countToDelete === 0) {
      return res.json({
        success: true,
        message: "Nenhuma resposta encontrada anterior à data especificada.",
        deletedCount: 0,
      })
    }

    console.log(`📊 Encontradas ${countToDelete} respostas para deletar`)

    // Se for dry run, apenas retorna a contagem
    if (dryRun === "true") {
      return res.json({
        success: true,
        message: "Simulação executada (nenhuma deleção realizada).",
        wouldDeleteCount: countToDelete,
        cutoffDate: cutoffDate.toISOString(),
      })
    }

    // Executar a deleção em lotes para evitar timeout
    const batchSize = 1000
    let totalDeleted = 0

    while (true) {
      // Buscar IDs dos documentos a serem deletados
      const docsToDelete = await Response.find({ createdAt: { $lte: cutoffDate } })
        .select("_id")
        .limit(batchSize)
        .lean()

      if (docsToDelete.length === 0) break // Não há mais documentos

      const idsToDelete = docsToDelete.map((doc) => doc._id)
      const deleteResult = await Response.deleteMany({ _id: { $in: idsToDelete } })

      totalDeleted += deleteResult.deletedCount
      console.log(`🔄 Deletadas ${deleteResult.deletedCount} respostas (total: ${totalDeleted})`)

      // Se deletou menos que o batch size, significa que acabou
      if (deleteResult.deletedCount < batchSize) {
        break
      }
    }

    console.log(`✅ Limpeza concluída: ${totalDeleted} respostas removidas`)

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
    await connectDB()

    const cutoffDate = new Date("2025-06-30T23:59:59Z")
    console.log(`🗑️ Limpeza específica: removendo todas as respostas até ${cutoffDate.toISOString()}`)

    // Contar primeiro
    const countToDelete = await Response.countDocuments({
      createdAt: { $lte: cutoffDate },
    })

    if (countToDelete === 0) {
      return res.json({
        success: true,
        message: "Nenhuma resposta encontrada até 30/06/2025.",
        deletedCount: 0,
      })
    }

    console.log(`📊 ${countToDelete} respostas serão removidas`)

    // Deletar em lotes para performance
    let totalDeleted = 0
    const batchSize = 2000

    while (totalDeleted < countToDelete) {
      // Buscar IDs dos documentos a serem deletados
      const docsToDelete = await Response.find({ createdAt: { $lte: cutoffDate } })
        .select("_id")
        .limit(batchSize)
        .lean()

      if (docsToDelete.length === 0) break // Não há mais documentos

      const idsToDelete = docsToDelete.map((doc) => doc._id)
      const result = await Response.deleteMany({ _id: { $in: idsToDelete } })

      totalDeleted += result.deletedCount
      console.log(`🔄 Progresso: ${totalDeleted}/${countToDelete} respostas removidas`)

      if (result.deletedCount === 0) break // Evita loop infinito
    }

    console.log(`✅ Limpeza de junho/2025 concluída: ${totalDeleted} respostas removidas`)

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
    await connectDB()

    console.log("🔧 Iniciando otimização do banco de dados...")

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

    let duplicatesRemoved = 0
    for (const duplicate of duplicates) {
      // Manter apenas o primeiro documento, remover os outros
      const docsToRemove = duplicate.docs.slice(1)
      await Response.deleteMany({ _id: { $in: docsToRemove } })
      duplicatesRemoved += docsToRemove.length
    }

    console.log(`🗑️ Removidas ${duplicatesRemoved} respostas duplicadas`)

    // 2. Estatísticas finais
    const finalStats = await Response.countDocuments()

    res.json({
      success: true,
      message: "Otimização concluída com sucesso!",
      duplicatesRemoved,
      totalResponsesAfterOptimization: finalStats,
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
