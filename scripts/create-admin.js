// scripts/create-admin.js
require("dotenv").config()
const mongoose = require("mongoose")

// Conectar ao banco principal
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})

const User = require("../models/User")

async function createAdminUser() {
  try {
    console.log("🔧 Criando usuário administrador...")    

    // Criar usuário admin
    const adminUser = new User({
      name: "User",
      email: "user@apinexus.com",
      password: "user123",
      role: "user",
    })

    await adminUser.save()

    console.log("✅ Usuário useristrador criado com sucesso!")
    console.log("📧 Email: user@apinexus.com")
    console.log("🔑 Senha: user123")
    console.log("⚠️ IMPORTANTE: Altere a senha após o primeiro login!")

    process.exit(0)
  } catch (error) {
    console.error("❌ Erro ao criar usuário:", error)
    process.exit(1)
  }
}

createAdminUser()
