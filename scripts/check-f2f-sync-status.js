// scripts/check-f2f-sync-status.js
require("dotenv").config()
const mongoose = require("mongoose")
const { getModel } = require("../config/dbManager")
const GoogleDriveService = require("../services/googleDriveService")

/**
 * Script para verificar o status de sincronização dos arquivos F2F
 *
 * Compara os arquivos no Google Drive com os dados no banco de dados
 * e mostra quais rodadas estão completas e quais estão faltando.
 *
 * Uso:
 *   node scripts/check-f2f-sync-status.js
 */

const F2F_2025_FOLDER_ID = "1CooU5x5fAUfDPBrX0UzvlnBVqKufWQ4q"

async function checkSyncStatus() {
  let driveService = null

  try {
    console.log("🔍 Verificando status de sincronização F2F 2025...")
    console.log("=".repeat(70))

    // Inicializar Google Drive Service
    console.log("\n🔌 Conectando ao Google Drive...")
    driveService = new GoogleDriveService()
    await driveService.initialize()

    // Conectar ao banco F2F
    console.log("🔌 Conectando ao banco de dados F2F...")
    const Response = await getModel("Response", "f2f")
    const Survey = await getModel("Survey", "f2f")

    // 1. Buscar arquivos no Google Drive
    console.log("\n📁 Buscando arquivos na pasta 2025 do Google Drive...")
    const driveResponse = await driveService.drive.files.list({
      q: `'${F2F_2025_FOLDER_ID}' in parents and trashed=false and mimeType='application/vnd.google-apps.spreadsheet'`,
      fields: "files(id, name, mimeType, modifiedTime)",
      orderBy: "name",
    })

    const driveFiles = driveResponse.data.files
    console.log(`   📄 Arquivos encontrados: ${driveFiles.length}`)

    // 2. Buscar surveys no banco de dados para 2025
    console.log("\n📊 Buscando surveys no banco de dados (ano 2025)...")
    const dbSurveys = await Survey.find({ year: 2025 }).lean()
    console.log(`   📋 Surveys encontradas: ${dbSurveys.length}`)

    // 3. Buscar contagem de responses por rodada
    console.log("\n📈 Contando responses por rodada...")
    const responsesByRodada = await Response.aggregate([
      { $match: { year: 2025 } },
      { $group: { _id: "$rodada", count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ])

    // Criar mapa de responses por rodada
    const responsesMap = {}
    responsesByRodada.forEach(r => {
      responsesMap[r._id] = r.count
    })

    // 4. Extrair número da rodada de cada arquivo do Drive
    console.log("\n" + "=".repeat(70))
    console.log("📋 COMPARAÇÃO: GOOGLE DRIVE vs BANCO DE DADOS")
    console.log("=".repeat(70))

    const results = []
    const missingInDB = []
    const synced = []

    for (const file of driveFiles) {
      // Extrair número da rodada do nome do arquivo
      const rodadaMatch = file.name.match(/RODADA\s*(\d+)/i)
      const rodada = rodadaMatch ? parseInt(rodadaMatch[1]) : null

      // Verificar se existe survey correspondente no banco
      const matchingSurvey = dbSurveys.find(s =>
        s.name && s.name.includes(file.name.replace(" (Google Sheets)", ""))
      )

      // Verificar responses para esta rodada
      const responseCount = rodada ? (responsesMap[rodada] || 0) : 0

      const status = {
        fileName: file.name,
        fileId: file.id,
        rodada: rodada,
        inDatabase: !!matchingSurvey,
        surveyName: matchingSurvey ? matchingSurvey.name : null,
        responseCount: responseCount,
        modifiedTime: file.modifiedTime
      }

      results.push(status)

      if (!matchingSurvey || responseCount === 0) {
        missingInDB.push(status)
      } else {
        synced.push(status)
      }
    }

    // 5. Exibir resultados
    console.log("\n✅ ARQUIVOS SINCRONIZADOS:")
    console.log("-".repeat(70))
    if (synced.length === 0) {
      console.log("   Nenhum arquivo sincronizado encontrado")
    } else {
      synced.forEach((s, i) => {
        console.log(`   ${i + 1}. Rodada ${s.rodada || '?'}: ${s.responseCount.toLocaleString()} responses`)
        console.log(`      📄 ${s.fileName}`)
      })
    }

    console.log("\n❌ ARQUIVOS NÃO SINCRONIZADOS (faltando no banco):")
    console.log("-".repeat(70))
    if (missingInDB.length === 0) {
      console.log("   ✅ Todos os arquivos estão sincronizados!")
    } else {
      missingInDB.forEach((m, i) => {
        console.log(`   ${i + 1}. Rodada ${m.rodada || '?'}: ${m.fileName}`)
        console.log(`      ID: ${m.fileId}`)
        console.log(`      Responses no banco: ${m.responseCount.toLocaleString()}`)
      })
    }

    // 6. Resumo por rodada no banco
    console.log("\n" + "=".repeat(70))
    console.log("📊 RESUMO DE RESPONSES NO BANCO (2025)")
    console.log("=".repeat(70))

    const allRodadas = [...new Set([
      ...Object.keys(responsesMap).map(Number),
      ...results.filter(r => r.rodada).map(r => r.rodada)
    ])].sort((a, b) => a - b)

    console.log("\n   Rodada  | No Banco    | No Drive")
    console.log("   " + "-".repeat(40))

    for (const rodada of allRodadas) {
      const inDB = responsesMap[rodada] || 0
      const inDrive = results.find(r => r.rodada === rodada) ? "✅" : "❌"
      const dbStatus = inDB > 0 ? `${inDB.toLocaleString().padStart(10)}` : "         0"
      console.log(`   ${String(rodada).padStart(6)}  | ${dbStatus} | ${inDrive}`)
    }

    // 7. Estatísticas finais
    console.log("\n" + "=".repeat(70))
    console.log("📈 ESTATÍSTICAS FINAIS")
    console.log("=".repeat(70))
    console.log(`   📁 Total de arquivos no Drive: ${driveFiles.length}`)
    console.log(`   ✅ Arquivos sincronizados: ${synced.length}`)
    console.log(`   ❌ Arquivos faltando: ${missingInDB.length}`)
    console.log(`   📝 Total de responses no banco (2025): ${Object.values(responsesMap).reduce((a, b) => a + b, 0).toLocaleString()}`)

    if (missingInDB.length > 0) {
      console.log("\n⚠️  AÇÃO NECESSÁRIA:")
      console.log("   Para sincronizar os arquivos faltantes, execute:")
      console.log("   curl \"http://localhost:4000/api/migration/sync-f2f-surveys?skipRounds=\"")
    }

  } catch (error) {
    console.error("\n❌ Erro:", error)
    throw error
  } finally {
    await mongoose.disconnect()
    console.log("\n👋 Conexões fechadas")
  }
}

// Executar
checkSyncStatus()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error("❌ Erro:", error)
    process.exit(1)
  })
