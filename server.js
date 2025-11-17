require("dotenv").config()
const express = require("express")
const cors = require("cors")

const { connectToDatabase } = require("./config/dbManager")

// ESCOLHA QUAL ROTA USAR:
// Opção 1: Rotas híbridas (BigQuery + MongoDB)
const dataRoutes = require("./routes/dataRoutesHybrid")

// Opção 2: Rotas originais (apenas MongoDB) - comentar se usar híbridas
// const dataRoutes = require("./routes/dataRoutes")

// Outras rotas
const migrationRoutes = require("./routes/migrationRoutes")
const maintenanceRoutes = require("./routes/maintenanceRoutes")
const authRoutes = require("./routes/authRoutes")
const userRoutes = require("./routes/userRoutes")
const googleRoutes = require("./routes/googleRoutes")

const app = express()

// Configurar trust proxy para funcionar com Vercel/proxies reversos
app.set('trust proxy', 1)

app.use(cors())
app.use(express.json({ limit: "50mb" }))

// Middleware de logging
if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
    next()
  })
}

// Rota raiz com informações sobre BigQuery
app.get("/", (req, res) => {
  res.json({
    message: "API Nexus - Sistema de Análise de Pesquisas",
    version: "2.0.0",
    status: "online",
    database: "hybrid",
    dataSource: {
      bigquery: process.env.USE_BIGQUERY === 'true',
      fallback: process.env.BIGQUERY_FALLBACK === 'true',
    },
    endpoints: {
      auth: "/api/auth",
      users: "/api/users",
      data: "/api/data",
      health: "/api/data/health",
      migration: "/api/migration",
      maintenance: "/api/maintenance",
    },
  })
})

// Rotas da API
app.use("/api/auth", authRoutes)
app.use("/api/users", userRoutes)
app.use("/api/data", dataRoutes)
app.use("/api/migration", migrationRoutes)
app.use("/api/maintenance", maintenanceRoutes)
app.use("/api/google", googleRoutes)

// 404
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint não encontrado",
    path: req.originalUrl,
  })
})

// Error handler
app.use((error, req, res, next) => {
  console.error("Erro não tratado:", error)
  res.status(500).json({
    success: false,
    message: "Erro interno no servidor",
    ...(process.env.NODE_ENV !== "production" && { error: error.message }),
  })
})

const PORT = process.env.PORT || 5000

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`)
  console.log(`📊 Modo: ${process.env.USE_BIGQUERY === 'true' ? 'BigQuery' : 'MongoDB'}`)
  if (process.env.BIGQUERY_FALLBACK === 'true') {
    console.log(`🔄 Fallback para MongoDB: Ativado`)
  }
  console.log(`🌐 Acesse: http://localhost:${PORT}`)

  connectToDatabase().catch((err) => {
    console.error("Falha ao conectar ao MongoDB:", err)
  })
})

module.exports = app