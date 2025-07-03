// config/dbManager.js
const mongoose = require("mongoose")

// Cache para as conexões e modelos
const cachedConnections = {}

// Configurações de conexão otimizadas
const connectionOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 5,
  serverSelectionTimeoutMS: 30000, // Aumentado para 30 segundos
  socketTimeoutMS: 45000,
  connectTimeoutMS: 30000,
}

// Função principal para conectar e gerenciar conexões
async function connectToDatabase(name, uri) {
  // Se já temos uma conexão em cache, reutilizamos
  if (cachedConnections[name]) {
    // Se a conexão está ativa, retorna
    if (cachedConnections[name].conn.readyState === 1) {
      console.log(`♻️  Reutilizando conexão em cache para: ${name}`)
      return cachedConnections[name]
    }
    // Se a conexão caiu, removemos do cache para recriar
    console.log(`🔌 Conexão ${name} perdida. Removendo do cache.`)
    delete cachedConnections[name]
  }

  console.log(`🔌 Criando NOVA conexão com o banco de dados: ${name}`)

  // Criar a promessa de conexão e armazenar no cache
  // Isso evita que múltiplas chamadas simultâneas criem múltiplas conexões
  const connectionPromise = mongoose
    .createConnection(uri, connectionOptions)
    .asPromise()
    .then((conn) => {
      console.log(`✅ MongoDB ${name} conectado com sucesso!`)

      // Registrar os modelos na conexão
      const models = {
        QuestionIndex: conn.model("QuestionIndex", require("../models/QuestionIndex").schema),
        Survey: conn.model("Survey", require("../models/Survey").schema),
        Response: conn.model("Response", require("../models/Response").schema),
        User: conn.model("User", require("../models/User").schema),
      }

      return { conn, models }
    })

  cachedConnections[name] = { promise: connectionPromise }

  try {
    // Aguardar a promessa ser resolvida e armazenar o resultado final
    cachedConnections[name] = await connectionPromise
    return cachedConnections[name]
  } catch (error) {
    // Se a conexão falhar, remover a promessa do cache para permitir nova tentativa
    delete cachedConnections[name]
    console.error(`❌ Erro fatal ao conectar com ${name}:`, error.message)
    throw error
  }
}

// Função para obter um modelo específico de um banco de dados
const getModel = async (modelName, year) => {
  const yearStr = String(year)
  const dbName = yearStr === "2025" && process.env.MONGODB_URI_2025 ? "2025" : "main"
  const uri = dbName === "2025" ? process.env.MONGODB_URI_2025 : process.env.MONGODB_URI

  if (!uri) {
    throw new Error(`URI do banco ${dbName} não configurada`)
  }

  const { models } = await connectToDatabase(dbName, uri)

  if (!models[modelName]) {
    throw new Error(`Modelo ${modelName} não encontrado no banco ${dbName}`)
  }

  return models[modelName]
}

// Função para obter todos os modelos de um tipo
const getAllModels = async (modelName) => {
  const modelInstances = []

  // Conectar ao banco principal
  const mainModel = await getModel(modelName, "main")
  modelInstances.push(mainModel)

  // Conectar ao banco 2025 se configurado
  if (process.env.MONGODB_URI_2025) {
    try {
      const model2025 = await getModel(modelName, "2025")
      modelInstances.push(model2025)
    } catch (error) {
      console.warn("⚠️  Não foi possível conectar ao banco 2025, continuando com o principal.")
    }
  }

  return modelInstances
}

module.exports = {
  getModel,
  getAllModels,
}
