// config/db.js
const mongoose = require("mongoose")

// Variável global para controlar o estado da conexão
let isConnected = false

const connectDB = async () => {
  // Se já estiver conectado, retorna
  if (isConnected) {
    return
  }

  // Se já existe uma conexão ativa
  if (mongoose.connections[0].readyState) {
    isConnected = true
    return
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      bufferCommands: false,
    })

    isConnected = true
    console.log("MongoDB conectado!")
  } catch (err) {
    console.error("Erro ao conectar no MongoDB:", err.message)
    isConnected = false
    throw err
  }
}

module.exports = connectDB
