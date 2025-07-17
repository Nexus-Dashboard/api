// config/dbManager.js
const mongoose = require("mongoose")

// Importar schemas para garantir que sejam carregados
const QuestionIndexSchema = require("../models/QuestionIndex").schema
const SurveySchema = require("../models/Survey").schema
const ResponseSchema = require("../models/Response").schema
const UserSchema = require("../models/User").schema

// Usar um cache global para persistir a conexão entre invocações de função serverless
let cached = global.mongoose

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null, models: {} }
}

const connectionOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  bufferCommands: false, // Importante para performance em serverless
}

async function connectToDatabase() {
  if (cached.conn) {
    console.log("♻️  Reutilizando conexão MongoDB existente.")
    return cached
  }

  if (!cached.promise) {
    if (!process.env.MONGODB_URI) {
      throw new Error("A variável de ambiente MONGODB_URI não está definida.")
    }
    console.log("🔌 Criando NOVA conexão com o MongoDB...")
    cached.promise = mongoose.connect(process.env.MONGODB_URI, connectionOptions).then((mongooseInstance) => {
      console.log("✅ MongoDB conectado com sucesso!")

      // Registrar modelos na instância principal do mongoose para evitar recompilação
      mongoose.model("QuestionIndex", QuestionIndexSchema)
      mongoose.model("Survey", SurveySchema)
      mongoose.model("Response", ResponseSchema)
      mongoose.model("User", UserSchema)

      return mongooseInstance
    })
  }

  try {
    cached.conn = await cached.promise
    // Mapear modelos para o cache para fácil acesso
    cached.models = {
      QuestionIndex: mongoose.models.QuestionIndex,
      Survey: mongoose.models.Survey,
      Response: mongoose.models.Response,
      User: mongoose.models.User,
    }
    return cached
  } catch (e) {
    cached.promise = null // Resetar a promessa em caso de falha
    console.error("❌ Erro fatal ao conectar com MongoDB:", e.message)
    throw e
  }
}

// Função simplificada para obter um modelo
const getModel = async (modelName) => {
  const { models } = await connectToDatabase()
  if (!models[modelName]) {
    throw new Error(`Modelo ${modelName} não encontrado.`)
  }
  return models[modelName]
}

// Mantida para compatibilidade, agora retorna apenas uma instância do modelo
const getAllModels = async (modelName) => {
  const model = await getModel(modelName)
  return [model]
}

module.exports = {
  getModel,
  getAllModels,
  connectToDatabase, // Exportar para "aquecer" a conexão na inicialização
}
