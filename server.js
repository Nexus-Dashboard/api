// server.js
require("dotenv").config()
const express = require("express")
const cors = require("cors")
const connectDB = require("./config/db")
const dataRoutes = require("./routes/dataRoutes")

const app = express()

// Middlewares
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
)

app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ extended: true, limit: "50mb" }))

// Rota básica para verificar status da API
app.get("/", async (req, res) => {
  try {
    // Testa a conexão com o banco
    await connectDB()
    res.json({ success: true, message: "API está ativa e conectada ao banco" })
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro ao conectar com o banco", error: error.message })
  }
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
