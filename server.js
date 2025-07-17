require("dotenv").config()
const express = require("express")
const cors = require("cors")

// Carregar dbManager para inicializar conexões
require("./config/dbManager")

// Importar rotas
const dataRoutes = require("./routes/dataRoutes")
const migrationRoutes = require("./routes/migrationRoutes")
const maintenanceRoutes = require("./routes/maintenanceRoutes")
const authRoutes = require("./routes/authRoutes")
const userRoutes = require("./routes/userRoutes")
const googleRoutes = require("./routes/googleRoutes")

const app = express()

// Middlewares
app.use(cors())
app.use(express.json({ limit: "50mb" }))

// Middleware de logging para desenvolvimento
if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
    next()
  })
}

// Rotas públicas
app.get("/", (req, res) => {
  res.json({
    message: "API Nexus - Sistema de Análise de Pesquisas",
    version: "1.0.0",
    status: "online",
    endpoints: {
      auth: "/api/auth",
      users: "/api/users",
      data: "/api/data",
      migration: "/api/migration",
      maintenance: "/api/maintenance",
    },
  })
})

// Log para verificar se as rotas estão sendo registradas
console.log("🔧 Registrando rotas da API...")
console.log("  - /api/auth (authRoutes)")
console.log("  - /api/users (userRoutes)")
console.log("  - /api/data (dataRoutes)")
console.log("  - /api/migration (migrationRoutes)")
console.log("  - /api/maintenance (maintenanceRoutes)")

// Rotas da API
app.use("/api/auth", authRoutes)
app.use("/api/users", userRoutes)
app.use("/api/data", dataRoutes)
app.use("/api/migration", migrationRoutes)
app.use("/api/maintenance", maintenanceRoutes)
app.use("/api/google", googleRoutes)

// Middleware de tratamento de erros 404
app.use("*", (req, res) => {
  console.log(`❌ Rota não encontrada: ${req.method} ${req.originalUrl}`)
  res.status(404).json({
    success: false,
    message: "Endpoint não encontrado",
    path: req.originalUrl,
    availableEndpoints: [
      "GET /",
      "POST /api/auth/login",
      "GET /api/data/themes",
      "GET /api/data/question/:code/responses",
    ],
  })
})

// Middleware global de tratamento de erros
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
  console.log(`📊 API Nexus - Sistema de Análise de Pesquisas`)
  console.log(`🔐 Autenticação JWT habilitada`)
  console.log(`🌐 Acesse: http://localhost:${PORT}`)
})

module.exports = app
