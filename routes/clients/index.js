// routes/clients/index.js
//
// Router do módulo de clientes (SESC / SENAC), montado em /api/clients.
// Totalmente isolado do fluxo da Secom: banco próprio, segredo de JWT
// próprio, model próprio e middleware de autenticação próprio.

const express = require("express")
const rateLimit = require("express-rate-limit")

const authRoutes = require("./authRoutes")
const adminRoutes = require("./adminRoutes")
const surveyRoutes = require("./surveyRoutes")

const router = express.Router()

// Mesmo padrão de routes/authRoutes.js:10-19 (express-rate-limit v6: `max`).
//
// ATENÇÃO: na Vercel o store em memória é POR INSTÂNCIA de lambda, então este
// limite é best-effort, não um controle. O controle durável contra força bruta
// é o lockout gravado no Mongo (loginAttempts/lockUntil em models/ClientUser).
const clientAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number.parseInt(process.env.CLIENT_AUTH_RATE_LIMIT) || 10,
  message: {
    success: false,
    code: "RATE_LIMITED",
    message: "Muitas tentativas de login. Tente novamente em 15 minutos.",
  },
  standardHeaders: true,
  legacyHeaders: false,
})

// Informações do módulo (pública, sem dado sensível)
router.get("/", (req, res) => {
  res.json({
    success: true,
    module: "clients-auth",
    description: "Autenticação e gestão de acessos dos clientes SESC e SENAC",
    version: "1.0.0",
    endpoints: {
      login: "POST /api/clients/auth/login",
      me: "GET /api/clients/auth/me",
      refresh: "POST /api/clients/auth/refresh",
      changePassword: "PUT /api/clients/auth/change-password",
      scopeCheck: "GET /api/clients/auth/scope/check",
      regions: "GET /api/clients/auth/meta/regions",
      admin: "/api/clients/users (requer papel nexus_admin)",
      surveys: "GET /api/clients/surveys",
      surveyData: "GET /api/clients/surveys/:surveyId/data",
    },
  })
})

router.use("/auth/login", clientAuthLimiter)
router.use("/auth", authRoutes)
router.use("/users", adminRoutes)
router.use("/surveys", surveyRoutes)

module.exports = router
