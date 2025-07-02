// config/dbManager.js
const mongoose = require("mongoose")

const connections = {}
const models = {}

// Configurações otimizadas para Vercel (sem opções depreciadas)
const connectionOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 5,
  serverSelectionTimeoutMS: 10000, // Aumentado para 10s
  connectTimeoutMS: 10000, // Adicionado timeout de conexão
  socketTimeoutMS: 45000,
}

// Definir schemas diretamente aqui para evitar dependência circular
const QuestionIndexSchema = new mongoose.Schema(
  {
    surveyNumber: String,
    surveyName: String,
    variable: { type: String, required: true },
    questionText: String,
    label: String,
    index: String,
    methodology: String,
    map: String,
    sample: String,
    date: String,
  },
  { timestamps: true },
)

QuestionIndexSchema.index({ variable: 1 })
QuestionIndexSchema.index({ surveyNumber: 1, variable: 1 }, { unique: true })

const SurveySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true },
    fileHashes: [{ type: String }],
  },
  { timestamps: true },
)

SurveySchema.index({ year: 1, month: 1 })

const AnswerSchema = new mongoose.Schema(
  {
    k: { type: String, required: true },
    v: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false },
)

const ResponseSchema = new mongoose.Schema(
  {
    surveyId: { type: mongoose.Schema.Types.ObjectId, ref: "Survey", required: true },
    entrevistadoId: { type: String, required: true },
    answers: [AnswerSchema],
    rodada: Number,
    year: Number,
  },
  {
    timestamps: true,
    minimize: false,
  },
)

ResponseSchema.index({ surveyId: 1 })
ResponseSchema.index({ "answers.k": 1 })
ResponseSchema.index({ year: 1, rodada: 1 }) // Índice adicional para performance

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Nome é obrigatório"],
      trim: true,
      maxlength: [100, "Nome não pode ter mais de 100 caracteres"],
    },
    email: {
      type: String,
      required: [true, "Email é obrigatório"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, "Email inválido"],
    },
    password: {
      type: String,
      required: [true, "Senha é obrigatória"],
      minlength: [6, "Senha deve ter pelo menos 6 caracteres"],
      select: false,
    },
    role: {
      type: String,
      enum: ["admin", "user", "viewer"],
      default: "user",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
)

UserSchema.index({ email: 1 })
UserSchema.index({ role: 1 })
UserSchema.index({ isActive: 1 })

// Função para criar conexão com retry
const createConnection = async (uri, name) => {
  if (connections[name]) {
    // Verificar se a conexão ainda está ativa
    if (connections[name].readyState === 1) {
      return connections[name]
    }
    // Se não estiver ativa, remover da cache
    delete connections[name]
    delete models[name]
  }

  console.log(`🔌 Criando nova conexão com o banco de dados: ${name}`)

  try {
    const connection = mongoose.createConnection(uri, connectionOptions)

    // Aguardar a conexão ser estabelecida
    await new Promise((resolve, reject) => {
      connection.once("connected", resolve)
      connection.once("error", reject)

      // Timeout de 10 segundos para conexão
      setTimeout(() => reject(new Error("Connection timeout")), 10000)
    })

    connection.on("connected", () => console.log(`✅ MongoDB ${name} conectado!`))
    connection.on("error", (err) => {
      console.error(`❌ Erro na conexão ${name}:`, err)
      // Remover conexão com erro da cache
      delete connections[name]
      delete models[name]
    })
    connection.on("disconnected", () => {
      console.log(`🔌 MongoDB ${name} desconectado.`)
      // Remover conexão desconectada da cache
      delete connections[name]
      delete models[name]
    })

    // Registrar todos os modelos para esta conexão
    models[name] = {
      QuestionIndex: connection.model("QuestionIndex", QuestionIndexSchema),
      Survey: connection.model("Survey", SurveySchema),
      Response: connection.model("Response", ResponseSchema),
      User: connection.model("User", UserSchema),
    }

    connections[name] = connection
    console.log(`✅ Conexão ${name} estabelecida com sucesso`)
    return connection
  } catch (error) {
    console.error(`❌ Erro ao conectar com ${name}:`, error)
    throw error
  }
}

// Função para garantir conexão ativa
const ensureConnection = async (name) => {
  if (!connections[name] || connections[name].readyState !== 1) {
    const uri = name === "2025" ? process.env.MONGODB_URI_2025 : process.env.MONGODB_URI
    if (!uri) {
      throw new Error(`URI do banco ${name} não configurada`)
    }
    await createConnection(uri, name)
  }
  return connections[name]
}

const getDb = async (year) => {
  const yearStr = String(year)
  const dbName = yearStr === "2025" && process.env.MONGODB_URI_2025 ? "2025" : "main"
  return await ensureConnection(dbName)
}

const getModel = async (modelName, year) => {
  const yearStr = String(year)
  const dbName = yearStr === "2025" && process.env.MONGODB_URI_2025 ? "2025" : "main"

  await ensureConnection(dbName)

  if (!models[dbName] || !models[dbName][modelName]) {
    throw new Error(`Modelo ${modelName} não encontrado no banco ${dbName}`)
  }

  return models[dbName][modelName]
}

const getAllDbs = async () => {
  const dbs = []

  // Garantir conexão principal
  await ensureConnection("main")
  dbs.push(connections["main"])

  // Garantir conexão 2025 se configurada
  if (process.env.MONGODB_URI_2025) {
    await ensureConnection("2025")
    dbs.push(connections["2025"])
  }

  return dbs
}

const getAllModels = async (modelName) => {
  const modelInstances = []

  // Modelo do banco principal
  await ensureConnection("main")
  if (models["main"] && models["main"][modelName]) {
    modelInstances.push(models["main"][modelName])
  }

  // Modelo do banco 2025 se configurado
  if (process.env.MONGODB_URI_2025) {
    await ensureConnection("2025")
    if (models["2025"] && models["2025"][modelName]) {
      modelInstances.push(models["2025"][modelName])
    }
  }

  return modelInstances
}

// Inicializar conexões na primeira execução
const initializeConnections = async () => {
  try {
    if (process.env.MONGODB_URI) {
      await createConnection(process.env.MONGODB_URI, "main")
    }
    if (process.env.MONGODB_URI_2025) {
      await createConnection(process.env.MONGODB_URI_2025, "2025")
    }
  } catch (error) {
    console.error("❌ Erro ao inicializar conexões:", error)
    // Não falhar completamente, deixar para conectar sob demanda
  }
}

// Inicializar apenas se não estivermos em ambiente de teste
if (process.env.NODE_ENV !== "test") {
  initializeConnections()
}

module.exports = {
  getDb,
  getModel,
  getAllDbs,
  getAllModels,
  ensureConnection,
}
