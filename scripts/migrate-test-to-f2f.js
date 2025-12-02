// scripts/migrate-test-to-f2f.js
require("dotenv").config()
const mongoose = require("mongoose")
const { getModel } = require("../config/dbManager")

/**
 * Script para migrar dados da collection 'test' para a collection 'f2f' (responses)
 *
 * Este script:
 * 1. Conecta ao banco de dados f2f
 * 2. Busca todos os documentos da collection 'test'
 * 3. Valida e transforma os dados conforme necessário
 * 4. Insere os dados na collection de responses do banco f2f
 */

async function migrateTestToF2F() {
  try {
    console.log("🚀 Iniciando migração de dados de 'test.responses' para 'f2f.responses'...")

    // Conectar ao banco TEST (origem)
    const TestResponse = await getModel("Response", "test")

    // Conectar ao banco F2F (destino)
    const F2FResponse = await getModel("Response", "f2f")
    const F2FSurvey = await getModel("Survey", "f2f")

    console.log("📊 Contando documentos na collection 'test.responses'...")
    const totalDocs = await TestResponse.countDocuments()
    console.log(`   Encontrados ${totalDocs} documentos para migrar`)

    if (totalDocs === 0) {
      console.log("⚠️  Nenhum documento encontrado na collection 'test.responses'. Abortando migração.")
      return
    }

    // Buscar todos os documentos da collection test
    console.log("📥 Buscando documentos da collection 'test.responses'...")
    const testDocs = await TestResponse.find({}).lean()

    console.log(`✅ ${testDocs.length} documentos carregados`)

    // Analisar a estrutura dos documentos
    console.log("\n🔍 Analisando estrutura dos dados...")
    if (testDocs.length > 0) {
      console.log("📋 Exemplo do primeiro documento:")
      console.log(JSON.stringify(testDocs[0], null, 2))

      console.log("\n📋 Campos encontrados:")
      const fields = Object.keys(testDocs[0])
      console.log("   -", fields.join(", "))
    }

    // Perguntar ao usuário se deseja continuar
    console.log("\n⚠️  ATENÇÃO: Este script irá migrar os dados para a collection 'responses' do banco f2f")
    console.log("   Para continuar, você precisa executar este script com a flag --confirm")

    if (!process.argv.includes("--confirm")) {
      console.log("\n❌ Migração cancelada. Execute com --confirm para prosseguir:")
      console.log("   node scripts/migrate-test-to-f2f.js --confirm")
      return
    }

    // Transformar e validar os dados
    console.log("\n🔄 Transformando dados para o formato Response...")
    const validResponses = []
    const invalidDocs = []

    for (let i = 0; i < testDocs.length; i++) {
      const doc = testDocs[i]

      try {
        // Verificar se o documento tem os campos necessários
        if (!doc.surveyId && !doc.surveyName) {
          throw new Error("Documento sem surveyId ou surveyName")
        }

        // Se tiver surveyName mas não tiver surveyId, buscar ou criar a survey no banco f2f
        let surveyId = doc.surveyId
        if (!surveyId && doc.surveyName) {
          const survey = await F2FSurvey.findOneAndUpdate(
            { name: doc.surveyName },
            {
              $set: {
                name: doc.surveyName,
                year: doc.year || new Date().getFullYear(),
                month: doc.rodada || doc.month
              }
            },
            { upsert: true, new: true }
          )
          surveyId = survey._id
        }

        // Criar o documento no formato Response
        const responseDoc = {
          surveyId: surveyId,
          entrevistadoId: doc.entrevistadoId || doc.respondentId || `resp_${i + 1}`,
          answers: doc.answers || [],
          rodada: doc.rodada || null,
          year: doc.year || new Date().getFullYear()
        }

        // Validar que tem pelo menos um answer
        if (!responseDoc.answers || responseDoc.answers.length === 0) {
          throw new Error("Documento sem respostas (answers)")
        }

        validResponses.push(responseDoc)
      } catch (error) {
        invalidDocs.push({
          doc: doc,
          error: error.message
        })
      }
    }

    console.log(`✅ ${validResponses.length} documentos válidos`)
    console.log(`❌ ${invalidDocs.length} documentos inválidos`)

    if (invalidDocs.length > 0) {
      console.log("\n⚠️  Documentos inválidos:")
      invalidDocs.slice(0, 5).forEach((item, idx) => {
        console.log(`   ${idx + 1}. Erro: ${item.error}`)
        console.log(`      Doc ID: ${item.doc._id}`)
      })
      if (invalidDocs.length > 5) {
        console.log(`   ... e mais ${invalidDocs.length - 5} documentos`)
      }
    }

    if (validResponses.length === 0) {
      console.log("\n❌ Nenhum documento válido para migrar. Abortando.")
      return
    }

    // Inserir os documentos em lotes
    console.log("\n💾 Inserindo documentos no banco f2f...")
    const batchSize = 1000
    let insertedCount = 0
    let errorCount = 0

    for (let i = 0; i < validResponses.length; i += batchSize) {
      const batch = validResponses.slice(i, i + batchSize)
      const batchNum = Math.floor(i / batchSize) + 1
      const totalBatches = Math.ceil(validResponses.length / batchSize)

      try {
        console.log(`   📦 Inserindo lote ${batchNum}/${totalBatches} (${batch.length} documentos)...`)
        const result = await F2FResponse.insertMany(batch, { ordered: false })
        insertedCount += result.length
        console.log(`      ✅ ${result.length} documentos inseridos`)
      } catch (error) {
        // Se houver erro, pode ser por duplicados ou outros problemas
        console.log(`      ⚠️  Erro no lote: ${error.message}`)

        // Tentar inserir um por um para identificar quais falharam
        for (const doc of batch) {
          try {
            await F2FResponse.create(doc)
            insertedCount++
          } catch (err) {
            errorCount++
          }
        }
      }
    }

    console.log("\n📊 Resumo da migração:")
    console.log(`   ✅ Documentos migrados com sucesso: ${insertedCount}`)
    console.log(`   ❌ Documentos com erro: ${errorCount}`)
    console.log(`   📋 Total processado: ${validResponses.length}`)

    // Perguntar se deseja deletar os dados da collection test
    if (process.argv.includes("--delete-test")) {
      console.log("\n🗑️  Deletando documentos da collection 'test.responses'...")
      const deleteResult = await TestResponse.deleteMany({})
      console.log(`   ✅ ${deleteResult.deletedCount} documentos deletados da collection 'test.responses'`)
    } else {
      console.log("\n⚠️  Os dados da collection 'test.responses' foram mantidos.")
      console.log("   Para deletar, execute com a flag --delete-test:")
      console.log("   node scripts/migrate-test-to-f2f.js --confirm --delete-test")
    }

    console.log("\n✅ Migração concluída!")

  } catch (error) {
    console.error("\n❌ Erro durante a migração:", error)
    throw error
  } finally {
    // Fechar conexões
    await mongoose.disconnect()
    console.log("\n👋 Conexões fechadas")
  }
}

// Executar a migração
migrateTestToF2F()
  .then(() => {
    console.log("✅ Script finalizado com sucesso")
    process.exit(0)
  })
  .catch((error) => {
    console.error("❌ Script finalizado com erro:", error)
    process.exit(1)
  })
