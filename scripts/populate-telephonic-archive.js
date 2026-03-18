/**
 * Popula o banco telephonic_archive (novo cluster) com rodadas 1 a 50
 * Fonte: backup local telephonic_responses.json
 *
 * Uso: node scripts/populate-telephonic-archive.js
 */

const mongoose = require('mongoose')
const fs = require('fs')
const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '../.env') })

const BACKUP_FILE = 'C:/Users/marco/OneDrive/Desktop/Nexus/docs/mongodb_export_2025-12-03T02-18-19/telephonic_responses.json'
const BATCH_SIZE = 500
const MIN_RODADA = 1
const MAX_RODADA = 50

const ResponseSchema = new mongoose.Schema(
  {
    surveyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey', required: true },
    entrevistadoId: { type: String, required: true },
    answers: [{ k: String, v: mongoose.Schema.Types.Mixed, _id: false }],
    rodada: Number,
    year: Number,
  },
  { timestamps: true, minimize: false }
)

async function main() {
  const uri = process.env.MONGODB_URI_TELEPHONIC_ARCHIVE
  if (!uri) {
    console.error('MONGODB_URI_TELEPHONIC_ARCHIVE não definida no .env')
    process.exit(1)
  }

  console.log('Conectando ao banco telephonic_archive...')
  const conn = await mongoose.createConnection(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
  }).asPromise()
  console.log(`Conectado: ${conn.name}\n`)

  const Response = conn.model('Response', ResponseSchema)

  // Verificar rodadas já existentes
  const existingRodadas = await Response.distinct('rodada')
  const existingSet = new Set(existingRodadas)
  if (existingRodadas.length > 0) {
    console.log('Rodadas já existentes no arquivo:', existingRodadas.sort((a, b) => a - b).join(', '))
  } else {
    console.log('Banco vazio. Iniciando carga completa.')
  }

  // Carregar backup
  console.log('\nCarregando backup...')
  const raw = fs.readFileSync(BACKUP_FILE, 'utf8')
  const allData = JSON.parse(raw)
  console.log(`Registros no backup: ${allData.length}`)

  // Filtrar rodadas 1-50 que ainda não foram inseridas
  const toInsert = allData.filter(
    r => r.rodada >= MIN_RODADA && r.rodada <= MAX_RODADA && !existingSet.has(r.rodada)
  )

  const rodadasCount = {}
  for (const r of toInsert) {
    rodadasCount[r.rodada] = (rodadasCount[r.rodada] || 0) + 1
  }

  console.log(`\nRegistros a inserir (rodadas ${MIN_RODADA}-${MAX_RODADA}): ${toInsert.length}`)
  console.log('Por rodada:')
  for (const k of Object.keys(rodadasCount).sort((a, b) => Number(a) - Number(b))) {
    console.log(`  Rodada ${k}: ${rodadasCount[k]} registros`)
  }

  if (toInsert.length === 0) {
    console.log('\nNada a inserir.')
    await conn.close()
    return
  }

  // Preparar docs (remover _id para o MongoDB gerar novos)
  const docs = toInsert.map(({ _id, __v, ...rest }) => {
    if (rest.surveyId && typeof rest.surveyId === 'string') {
      rest.surveyId = new mongoose.Types.ObjectId(rest.surveyId)
    }
    return rest
  })

  // Inserir em lotes
  console.log(`\nInserindo em lotes de ${BATCH_SIZE}...`)
  let inserted = 0
  const startTime = Date.now()

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE)
    await Response.insertMany(batch, { ordered: false })
    inserted += batch.length
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    const pct = ((inserted / docs.length) * 100).toFixed(1)
    process.stdout.write(`\r  Progresso: ${inserted}/${docs.length} (${pct}%) - ${elapsed}s`)
  }

  console.log('\n\nMigração concluída!')
  console.log(`Total inserido: ${inserted} registros`)

  // Verificação final
  console.log('\nVerificação final:')
  const finalRodadas = await Response.aggregate([
    { $group: { _id: '$rodada', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ])
  for (const r of finalRodadas) {
    console.log(`  Rodada ${r._id}: ${r.count} registros`)
  }

  await conn.close()
  console.log('\nPronto!')
}

main().catch(err => {
  console.error('\nErro:', err)
  process.exit(1)
})
