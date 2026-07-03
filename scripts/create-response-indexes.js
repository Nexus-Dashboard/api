// scripts/create-response-indexes.js
// Cria o índice composto { "answers.k": 1, rodada: 1 } na coleção "responses"
// dos três bancos (telephonic, telephonic_archive, f2f).
//
// Uso: node scripts/create-response-indexes.js
//
// O build é online (MongoDB 4.2+): não bloqueia leituras nem escritas.
// Se a conexão cair no meio, o build continua no servidor — rode o script
// de novo para confirmar (createIndex é idempotente).
const mongoose = require("mongoose")
require("dotenv").config()

const TARGETS = [
  { key: "telephonic", envVar: "MONGODB_URI" },
  { key: "telephonic_archive", envVar: "MONGODB_URI_TELEPHONIC_ARCHIVE" },
  { key: "f2f", envVar: "MONGODB_URI_SECUNDARIO" },
]

const INDEX_SPEC = { "answers.k": 1, rodada: 1 }

async function createIndexOn(target) {
  const uri = process.env[target.envVar]
  if (!uri) {
    console.warn(`⚠️  [${target.key}] variável ${target.envVar} não definida — pulando`)
    return
  }

  console.log(`\n🔌 [${target.key}] conectando...`)
  const conn = await mongoose
    .createConnection(uri, {
      serverSelectionTimeoutMS: 10000,
      // Sem timeout de socket: o build do índice pode levar vários minutos
      socketTimeoutMS: 0,
    })
    .asPromise()

  try {
    const collection = conn.db.collection("responses")

    const count = await collection.estimatedDocumentCount()
    const before = await collection.indexes()
    console.log(`📊 [${target.key}] ~${count.toLocaleString("pt-BR")} documentos`)
    console.log(`📋 [${target.key}] índices atuais: ${before.map((i) => i.name).join(", ")}`)

    const alreadyExists = before.some(
      (i) => JSON.stringify(i.key) === JSON.stringify(INDEX_SPEC),
    )
    if (alreadyExists) {
      console.log(`✅ [${target.key}] índice composto já existe — nada a fazer`)
      return
    }

    console.log(`🏗️  [${target.key}] criando índice ${JSON.stringify(INDEX_SPEC)}...`)
    const start = Date.now()
    const name = await collection.createIndex(INDEX_SPEC)
    const seconds = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`✅ [${target.key}] índice "${name}" criado em ${seconds}s`)
  } finally {
    await conn.close()
  }
}

async function main() {
  let failed = false
  for (const target of TARGETS) {
    try {
      await createIndexOn(target)
    } catch (error) {
      failed = true
      console.error(`❌ [${target.key}] erro: ${error.message}`)
    }
  }
  process.exit(failed ? 1 : 0)
}

main()
