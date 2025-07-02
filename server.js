require("dotenv").config()
const express = require("express")
const cors = require("cors")

// Não chame connectDB() aqui, o dbManager já cuida disso.
// const connectDB = require("./config/db");
require("./config/dbManager") // Apenas carrega e inicializa as conexões

const dataRoutes = require("./routes/dataRoutes")
const migrationRoutes = require("./routes/migrationRoutes")
const maintenanceRoutes = require("./routes/maintenanceRoutes")

const app = express()

// Middlewares
app.use(cors())
app.use(express.json({ limit: "50mb" }))

// Rotas
app.use("/api/data", dataRoutes)
app.use("/api/migration", migrationRoutes)
app.use("/api/maintenance", maintenanceRoutes)

app.get("/", (req, res) => {
  res.send("API is running with multiple DB connections...")
})

const PORT = process.env.PORT || 5000

app.listen(PORT, () => console.log(`Server running on port ${PORT}`))

module.exports = app
