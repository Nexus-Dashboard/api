// scripts/update-f2f-rodada13.js
require("dotenv").config()
const mongoose = require("mongoose")
const { getModel } = require("../config/dbManager")
const GoogleDriveService = require("../services/googleDriveService")

/**
 * Script para atualizar a Rodada 13 do F2F
 *
 * Este script:
 * 1. Deleta os dados antigos da Rodada 13 (responses e survey)
 * 2. Busca o novo arquivo no Google Drive (pasta 2025)
 * 3. Importa os novos dados para o banco f2f
 *
 * Uso:
 *   node scripts/update-f2f-rodada13.js           # Modo simulação (dry-run)
 *   node scripts/update-f2f-rodada13.js --confirm # Executa a atualização
 */

const F2F_2025_FOLDER_ID = "1CooU5x5fAUfDPBrX0UzvlnBVqKufWQ4q"
const RODADA = 13
const YEAR = 2025

async function updateF2FRodada13() {
  let driveService = null

  try {
    console.log("🚀 Iniciando atualização da Rodada 13 do F2F...")
    console.log(`📁 Pasta do Google Drive: ${F2F_2025_FOLDER_ID}`)
    console.log(`📅 Ano: ${YEAR} | Rodada: ${RODADA}`)

    const isDryRun = !process.argv.includes("--confirm")
    if (isDryRun) {
      console.log("\n⚠️  MODO SIMULAÇÃO (dry-run) - Nenhuma alteração será feita")
      console.log("   Para executar de verdade, use: node scripts/update-f2f-rodada13.js --confirm\n")
    }

    // Inicializar Google Drive Service
    console.log("🔌 Conectando ao Google Drive...")
    driveService = new GoogleDriveService()
    await driveService.initialize()
    console.log("✅ Google Drive conectado")

    // Conectar ao banco F2F
    console.log("🔌 Conectando ao banco de dados F2F...")
    const Response = await getModel("Response", "f2f")
    const Survey = await getModel("Survey", "f2f")
    console.log("✅ Banco de dados conectado")

    // 1. Buscar dados atuais da Rodada 13
    console.log("\n📊 Analisando dados atuais da Rodada 13...")

    const currentResponses = await Response.countDocuments({ rodada: RODADA, year: YEAR })
    const currentSurveys = await Survey.find({ month: RODADA, year: YEAR }).lean()

    console.log(`   📝 Responses encontradas: ${currentResponses.toLocaleString()}`)
    console.log(`   📋 Surveys encontradas: ${currentSurveys.length}`)

    if (currentSurveys.length > 0) {
      console.log("   📋 Surveys da Rodada 13:")
      currentSurveys.forEach((s, i) => {
        console.log(`      ${i + 1}. ${s.name} (ID: ${s._id})`)
      })
    }

    // 2. Buscar o novo arquivo no Google Drive
    console.log("\n🔍 Buscando arquivo da Rodada 13 no Google Drive...")

    const response = await driveService.drive.files.list({
      q: `'${F2F_2025_FOLDER_ID}' in parents and trashed=false and mimeType='application/vnd.google-apps.spreadsheet'`,
      fields: "files(id, name, mimeType, modifiedTime)",
      orderBy: "name",
    })

    const allFiles = response.data.files
    console.log(`   📁 Arquivos encontrados na pasta: ${allFiles.length}`)

    // Filtrar arquivos da Rodada 13
    const rodada13Files = allFiles.filter(f =>
      f.name.includes("RODADA 13") ||
      f.name.includes("RODADA13") ||
      f.name.toLowerCase().includes("rodada 13")
    )

    if (rodada13Files.length === 0) {
      console.log("\n❌ Nenhum arquivo da Rodada 13 encontrado!")
      console.log("   Arquivos disponíveis:")
      allFiles.forEach((f, i) => console.log(`      ${i + 1}. ${f.name}`))
      return
    }

    console.log(`\n✅ Arquivo(s) da Rodada 13 encontrado(s):`)
    rodada13Files.forEach((f, i) => {
      console.log(`   ${i + 1}. ${f.name}`)
      console.log(`      ID: ${f.id}`)
      console.log(`      Modificado: ${f.modifiedTime}`)
    })

    // Usar o primeiro arquivo encontrado
    const targetFile = rodada13Files[0]
    console.log(`\n📄 Processando: ${targetFile.name}`)

    // 3. Ler os dados do novo arquivo
    console.log("📥 Lendo dados do Google Sheets...")
    const fileData = await driveService.readGoogleSheetsFile(targetFile.id)

    let totalNewResponses = 0
    const sheetsInfo = []

    for (const sheetName of Object.keys(fileData.sheets)) {
      const sheetData = fileData.sheets[sheetName]
      if (sheetData && sheetData.length > 1) {
        const rowCount = sheetData.length - 1 // -1 para header
        totalNewResponses += rowCount
        sheetsInfo.push({ name: sheetName, rows: rowCount })
      }
    }

    console.log(`\n📊 Dados do novo arquivo:`)
    console.log(`   📋 Abas encontradas: ${sheetsInfo.length}`)
    sheetsInfo.forEach(s => console.log(`      - ${s.name}: ${s.rows.toLocaleString()} respostas`))
    console.log(`   📝 Total de respostas: ${totalNewResponses.toLocaleString()}`)

    // 4. Resumo da operação
    console.log("\n" + "=".repeat(60))
    console.log("📋 RESUMO DA OPERAÇÃO:")
    console.log("=".repeat(60))
    console.log(`   🗑️  Deletar: ${currentResponses.toLocaleString()} responses antigas`)
    console.log(`   🗑️  Deletar: ${currentSurveys.length} survey(s) antiga(s)`)
    console.log(`   ➕ Inserir: ${totalNewResponses.toLocaleString()} responses novas`)
    console.log(`   📄 Fonte: ${targetFile.name}`)
    console.log("=".repeat(60))

    if (isDryRun) {
      console.log("\n⚠️  SIMULAÇÃO CONCLUÍDA - Nenhuma alteração foi feita")
      console.log("   Para executar de verdade, use: node scripts/update-f2f-rodada13.js --confirm")
      return
    }

    // 5. Executar a atualização
    console.log("\n🔄 Iniciando atualização...")

    // 5.1 Deletar responses antigas
    console.log("🗑️  Deletando responses antigas da Rodada 13...")
    const deleteResponsesResult = await Response.deleteMany({ rodada: RODADA, year: YEAR })
    console.log(`   ✅ ${deleteResponsesResult.deletedCount} responses deletadas`)

    // 5.2 Deletar surveys antigas e seus hashes
    console.log("🗑️  Deletando surveys antigas da Rodada 13...")
    for (const survey of currentSurveys) {
      await Survey.deleteOne({ _id: survey._id })
      console.log(`   ✅ Survey deletada: ${survey.name}`)
    }

    // 5.3 Inserir novos dados
    console.log("\n💾 Inserindo novos dados...")

    let totalInserted = 0
    const fileHash = `${targetFile.id}-${targetFile.modifiedTime}`

    for (const sheetName of Object.keys(fileData.sheets)) {
      const sheetData = fileData.sheets[sheetName]
      if (!sheetData || sheetData.length < 2) continue

      const headers = sheetData[0].map((h) => (h ? h.toString().toUpperCase() : ""))
      const dataRows = sheetData.slice(1)

      if (headers.length === 0 || dataRows.length === 0) continue

      const surveyName = `${targetFile.name} - ${sheetName}`
      console.log(`\n   📋 Processando aba: ${sheetName}`)

      // Criar nova survey
      const survey = await Survey.findOneAndUpdate(
        { name: surveyName },
        {
          $set: { year: YEAR, month: RODADA },
          $addToSet: { fileHashes: fileHash }
        },
        { upsert: true, new: true }
      )
      console.log(`   ✅ Survey criada: ${surveyName}`)

      // Preparar responses
      const responses = dataRows.map((row, index) => {
        const entrevistadoId = row[0] || `resp_${index + 1}`
        const answers = headers
          .map((key, idx) => {
            const value = row[idx]
            if (!key || value === null || value === undefined || value === "") return null
            return { k: key, v: value }
          })
          .filter(Boolean)

        return {
          surveyId: survey._id,
          entrevistadoId: entrevistadoId.toString(),
          answers,
          rodada: RODADA,
          year: YEAR,
        }
      })

      // Inserir em lotes
      const batchSize = 1000
      for (let i = 0; i < responses.length; i += batchSize) {
        const batch = responses.slice(i, i + batchSize)
        await Response.insertMany(batch, { ordered: false, lean: true })
        console.log(`   📝 Inserido lote ${Math.floor(i / batchSize) + 1}: ${batch.length} respostas`)
      }

      totalInserted += responses.length
    }

    // 6. Resumo final
    console.log("\n" + "=".repeat(60))
    console.log("✅ ATUALIZAÇÃO CONCLUÍDA COM SUCESSO!")
    console.log("=".repeat(60))
    console.log(`   🗑️  Responses deletadas: ${deleteResponsesResult.deletedCount}`)
    console.log(`   🗑️  Surveys deletadas: ${currentSurveys.length}`)
    console.log(`   ➕ Responses inseridas: ${totalInserted.toLocaleString()}`)
    console.log("=".repeat(60))

  } catch (error) {
    console.error("\n❌ Erro durante a atualização:", error)
    throw error
  } finally {
    await mongoose.disconnect()
    console.log("\n👋 Conexões fechadas")
  }
}

// Executar
updateF2FRodada13()
  .then(() => {
    console.log("✅ Script finalizado com sucesso")
    process.exit(0)
  })
  .catch((error) => {
    console.error("❌ Script finalizado com erro:", error)
    process.exit(1)
  })
