// config/dbManager.js
const mongoose = require("mongoose")

// Importar todos os schemas
const QuestionIndexSchema = require("../models/QuestionIndex").schema
const SurveySchema = require("../models/Survey").schema
const ResponseSchema = require("../models/Response").schema

const connections = {}
const models = {}

const createConnection = (uri, name) => {
  if (connections[name]) {
    return connections[name]
  }

  console.log(`🔌 Criando nova conexão com o banco de dados: ${name}`)
  const connection = mongoose.createConnection(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  })

  connection.on("connected", () => console.log(`✅ MongoDB ${name} conectado!`))
  connection.on("error", (err) => console.error(`❌ Erro na conexão ${name}:`, err))
  connection.on("disconnected", () => console.log(`🔌 MongoDB ${name} desconectado.`))

  // Registrar todos os modelos para esta conexão
  models[name] = {
    QuestionIndex: connection.model("QuestionIndex", QuestionIndexSchema),
    Survey: connection.model("Survey", SurveySchema),
    Response: connection.model("Response", ResponseSchema),
  }

  connections[name] = connection
  return connection
}

// Inicializar as conexões
createConnection(process.env.MONGODB_URI, "main")
if (process.env.MONGODB_URI_2025) {
  createConnection(process.env.MONGODB_URI_2025, "2025")
}

const getDb = (year) => {
  const yearStr = String(year)
  if (yearStr === "2025" && connections["2025"]) {
    return connections["2025"]
  }
  return connections["main"]
}

const getModel = (modelName, year) => {
  const yearStr = String(year)
  if (yearStr === "2025" && models["2025"]) {
    return models["2025"][modelName]
  }
  return models["main"][modelName]
}

const getAllDbs = () => {
  return Object.values(connections)
}

const getAllModels = (modelName) => {
  const modelInstances = []
  if (models["main"] && models["main"][modelName]) {
    modelInstances.push(models["main"][modelName])
  }
  if (models["2025"] && models["2025"][modelName]) {
    modelInstances.push(models["2025"][modelName])
  }
  return modelInstances
}

module.exports = {
  getDb,
  getModel,
  getAllDbs,
  getAllModels,
}
