// scripts/optimize-database.js
const mongoose = require("mongoose")
const Response = require("../models/Response")
const Survey = require("../models/Survey")
require("dotenv").config()

async function optimizeDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI)
    console.log("Conectado ao MongoDB")

    // 1. Remover respostas duplicadas (mesmo surveyId + entrevistadoId)
    console.log("🧹 Removendo duplicatas...")
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

    let removedCount = 0
    for (const duplicate of duplicates) {
      // Manter apenas o primeiro, remover os outros
      const toRemove = duplicate.docs.slice(1)
      await Response.deleteMany({ _id: { $in: toRemove } })
      removedCount += toRemove.length
    }

    console.log(`✅ Removidas ${removedCount} respostas duplicadas`)

    // 2. Remover respostas com arrays de answers vazios
    console.log("🧹 Removendo respostas vazias...")
    const emptyResponses = await Response.deleteMany({
      $or: [{ answers: { $size: 0 } }, { answers: { $exists: false } }],
    })
    console.log(`✅ Removidas ${emptyResponses.deletedCount} respostas vazias`)

    // 3. Estatísticas finais
    const totalResponses = await Response.countDocuments()
    const totalSurveys = await Survey.countDocuments()

    console.log("\n📊 Estatísticas finais:")
    console.log(`- Total de pesquisas: ${totalSurveys}`)
    console.log(`- Total de respostas: ${totalResponses}`)

    // 4. Verificar espaço usado (aproximado)
    const stats = await mongoose.connection.db.stats()
    console.log(`- Espaço usado: ${(stats.dataSize / 1024 / 1024).toFixed(2)} MB`)

    console.log("\n✅ Otimização concluída!")
  } catch (error) {
    console.error("Erro durante otimização:", error)
  } finally {
    await mongoose.disconnect()
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  optimizeDatabase()
}

module.exports = optimizeDatabase
