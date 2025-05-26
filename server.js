// server.js
require("dotenv").config()
const express = require("express")
const cors = require("cors")
const connectDB = require("./config/db")
const dataRoutes = require("./routes/dataRoutes")

const app = express()

// Variável para controlar conexão do banco em ambiente serverless
let isConnected = false

// Função para conectar ao banco de forma otimizada para serverless
const dbConnect = async () => {
  if (isConnected) return

  try {
    await connectDB()
    isConnected = true
    console.log("Conexão com MongoDB estabelecida")
  } catch (error) {
    console.error("Erro ao conectar com o banco:", error)
  }
}

// Conecta ao banco
dbConnect()

// Middlewares
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
)

app.use(express.json({ limit: "50mb" }))
// se usar form-urlencoded em algum lugar, faça o mesmo:
app.use(express.urlencoded({ extended: true, limit: "50mb" }))

// Rota básica para verificar status da API
app.get("/", (req, res) => {
  res.json({ success: true, message: "API está ativa" })
})

// Rotas da API
app.use("/api", dataRoutes)

// Para desenvolvimento local
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 4000
  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`)
  })
}

// Para Vercel, exportamos o app
module.exports = app
