// config/db.js
const mongoose = require("mongoose")

// Configuração otimizada para serverless
mongoose.set("bufferCommands", false)
mongoose.set("bufferMaxEntries", 0)

const connectDB = async () => {
  try {
    // Se já estiver conectado, retorna
    if (mongoose.connections[0].readyState) {
      console.log("MongoDB já conectado")
      return
    }

    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      bufferCommands: false, // Disable mongoose buffering
      bufferMaxEntries: 0, // Disable mongoose buffering
    })

    console.log("MongoDB conectado!")
  } catch (err) {
    console.error("Erro ao conectar no MongoDB:", err.message)
    // Em ambiente serverless, não fazemos process.exit
    if (process.env.NODE_ENV !== "production") {
      process.exit(1)
    }
    throw err
  }
}

module.exports = connectDB
