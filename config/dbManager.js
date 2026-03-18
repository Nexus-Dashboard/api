// config/dbManager.js
const mongoose = require("mongoose")

// Importar schemas para garantir que sejam carregados
const QuestionIndexSchema = require("../models/QuestionIndex").schema
const SurveySchema = require("../models/Survey").schema
const ResponseSchema = require("../models/Response").schema
const UserSchema = require("../models/User").schema

// Usar um cache global para persistir as conexões entre invocações de função serverless
// Agora o cache irá armazenar múltiplas conexões, uma para cada banco de dados.
if (!global.mongooseConnections) {
  global.mongooseConnections = {}
}

const connectionOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  bufferCommands: false,
}

// Função de conexão agora aceita uma chave para identificar o banco de dados
async function connectToDatabase(dbKey = "f2f") {
  let cached = global.mongooseConnections[dbKey]
  if (!cached) {
    cached = global.mongooseConnections[dbKey] = { conn: null, promise: null, models: {} }
  }

  if (cached.conn) {
    console.log(`♻️  Reutilizando conexão MongoDB existente para [${dbKey}].`)
    return cached
  }

  if (!cached.promise) {
    // Seleciona a URI com base na chave
    let uri
    if (dbKey === "telephonic") {
      uri = process.env.MONGODB_URI
    } else if (dbKey === "telephonic_archive") {
      uri = process.env.MONGODB_URI_TELEPHONIC_ARCHIVE
    } else if (dbKey === "f2f") {
      uri = process.env.MONGODB_URI_SECUNDARIO
    } else if (dbKey === "test") {
      // Para o banco "test", usar a mesma conexão mas trocar o nome do database
      uri = process.env.MONGODB_URI_SECUNDARIO.replace("/f2f?", "/test?")
    } else {
      // Default para f2f
      uri = process.env.MONGODB_URI_SECUNDARIO
    }

    if (!uri) {
      throw new Error(`A variável de ambiente para a chave '${dbKey}' não está definida.`)
    }

    console.log(`🔌 Criando NOVA conexão com o MongoDB para [${dbKey}]...`)
    cached.promise = mongoose.createConnection(uri, connectionOptions).asPromise()
  }

  try {
    cached.conn = await cached.promise
    console.log(`✅ MongoDB [${dbKey}] conectado com sucesso!`)

    // Registrar modelos na instância da conexão para evitar recompilação e conflitos
    cached.models = {
      QuestionIndex: cached.conn.model("QuestionIndex", QuestionIndexSchema),
      Survey: cached.conn.model("Survey", SurveySchema),
      Response: cached.conn.model("Response", ResponseSchema),
      User: cached.conn.model("User", UserSchema),
    }

    return cached
  } catch (e) {
    cached.promise = null // Resetar a promessa em caso de falha
    console.error(`❌ Erro fatal ao conectar com MongoDB [${dbKey}]:`, e.message)
    throw e
  }
}

// Função para obter um modelo do banco de dados especificado
const getModel = async (modelName, dbKey = "f2f") => {
  const { models } = await connectToDatabase(dbKey)
  if (!models[modelName]) {
    // Tenta registrar o modelo se ele não existir (fallback)
    const { conn } = await connectToDatabase(dbKey)
    const schemas = { QuestionIndexSchema, SurveySchema, ResponseSchema, UserSchema }
    const schema = schemas[`${modelName}Schema`]
    if (!schema) {
      throw new Error(`Schema para o modelo ${modelName} não encontrado.`)
    }
    models[modelName] = conn.model(modelName, schema)
  }
  return models[modelName]
}

// Retorna modelos de todas as conexões relevantes para o dbKey.
// Para "telephonic", busca também no banco arquivo (rodadas 1-50).
const getAllModels = async (modelName, dbKey = "f2f") => {
  if (dbKey === "telephonic" && process.env.MONGODB_URI_TELEPHONIC_ARCHIVE) {
    const [mainModel, archiveModel] = await Promise.all([
      getModel(modelName, "telephonic"),
      getModel(modelName, "telephonic_archive"),
    ])
    return [mainModel, archiveModel]
  }
  const model = await getModel(modelName, dbKey)
  return [model]
}

module.exports = {
  getModel,
  getAllModels,
  connectToDatabase,
}
