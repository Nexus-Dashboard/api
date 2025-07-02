// config/dbManager.js
const mongoose = require("mongoose")

const connections = {}
const models = {}

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
    User: connection.model("User", UserSchema),
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
