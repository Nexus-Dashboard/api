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

    // Verificar se já existe um admin
    const existingAdmin = await User.findOne({ role: "admin" })
    if (existingAdmin) {
      console.log("⚠️ Já existe um usuário administrador:", existingAdmin.email)
      process.exit(0)
    }

    // Criar usuário admin
    const adminUser = new User({
      name: "Administrador",
      email: "admin@apinexus.com",
      password: "admin123",
      role: "admin",
    })

    await adminUser.save()

    console.log("✅ Usuário administrador criado com sucesso!")
    console.log("📧 Email: admin@apinexus.com")
    console.log("🔑 Senha: admin123")
    console.log("⚠️ IMPORTANTE: Altere a senha após o primeiro login!")

    process.exit(0)
  } catch (error) {
    console.error("❌ Erro ao criar usuário administrador:", error)
    process.exit(1)
  }
}

createAdminUser()
