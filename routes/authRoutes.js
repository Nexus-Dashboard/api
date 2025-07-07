const express = require("express")
const jwt = require("jsonwebtoken")
const rateLimit = require("express-rate-limit")
const { getModel } = require("../config/dbManager")
const { authenticate, authorize } = require("../middleware/auth")

const router = express.Router()

// Rate limiting para rotas de autenticação
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // máximo 5 tentativas por IP
  message: {
    success: false,
    message: "Muitas tentativas de login. Tente novamente em 15 minutos.",
  },
  standardHeaders: true,
  legacyHeaders: false,
})

// Função para gerar JWT
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  })
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role = "user" } = req.body

    // Validações básicas
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Nome, email e senha são obrigatórios",
      })
    }

    const User = await getModel("User", "main")

    // Verificar se o usuário já existe
    const existingUser = await User.findOne({ email })
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Usuário já existe com este email",
      })
    }

    // Criar novo usuário
    const user = new User({
      name,
      email,
      password,
      role,
    })

    await user.save()

    console.log(`✅ Novo usuário criado: ${email} (${role})`)

    res.status(201).json({
      success: true,
      message: "Usuário criado com sucesso",
      user: user.toPublicJSON(),
    })
  } catch (error) {
    console.error("Erro ao registrar usuário:", error)

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message)
      return res.status(400).json({
        success: false,
        message: "Dados inválidos",
        errors: messages,
      })
    }

    res.status(500).json({
      success: false,
      message: "Erro interno no servidor",
    })
  }
})

// POST /api/auth/login
// Login do usuário
router.post("/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email e senha são obrigatórios",
      })
    }

    const User = await getModel("User", "main")

    // Buscar usuário com senha
    const user = await User.findOne({ email }).select("+password")

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Credenciais inválidas",
      })
    }

    // Verificar se a conta está bloqueada
    if (user.isLocked) {
      return res.status(423).json({
        success: false,
        message: "Conta temporariamente bloqueada devido a muitas tentativas de login",
      })
    }

    // Verificar se a conta está ativa
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Conta desativada",
      })
    }

    // Verificar senha
    const isPasswordValid = await user.comparePassword(password)

    if (!isPasswordValid) {
      // Incrementar tentativas de login
      await user.incLoginAttempts()

      return res.status(401).json({
        success: false,
        message: "Credenciais inválidas",
      })
    }

    // Login bem-sucedido - resetar tentativas
    await user.resetLoginAttempts()

    // Gerar token
    const token = generateToken(user._id)

    console.log(`✅ Login realizado: ${email}`)

    res.json({
      success: true,
      message: "Login realizado com sucesso",
      token,
      user: user.toPublicJSON(),
    })
  } catch (error) {
    console.error("Erro no login:", error)
    res.status(500).json({
      success: false,
      message: "Erro interno no servidor",
    })
  }
})

// POST /api/auth/refresh
// Renovar token
router.post("/refresh", authenticate, async (req, res) => {
  try {
    const newToken = generateToken(req.user._id)

    res.json({
      success: true,
      message: "Token renovado com sucesso",
      token: newToken,
      user: req.user.toPublicJSON(),
    })
  } catch (error) {
    console.error("Erro ao renovar token:", error)
    res.status(500).json({
      success: false,
      message: "Erro interno no servidor",
    })
  }
})

// GET /api/auth/me
// Obter dados do usuário atual
router.get("/me", authenticate, async (req, res) => {
  try {
    res.json({
      success: true,
      user: req.user.toPublicJSON(),
    })
  } catch (error) {
    console.error("Erro ao buscar dados do usuário:", error)
    res.status(500).json({
      success: false,
      message: "Erro interno no servidor",
    })
  }
})

// PUT /api/auth/profile
// Atualizar perfil do usuário
router.put("/profile", authenticate, async (req, res) => {
  try {
    const { name, email } = req.body
    const userId = req.user._id

    const User = await getModel("User", "main")

    // Verificar se o email já está em uso por outro usuário
    if (email && email !== req.user.email) {
      const existingUser = await User.findOne({ email, _id: { $ne: userId } })
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "Email já está em uso por outro usuário",
        })
      }
    }

    // Atualizar dados
    const updateData = {}
    if (name) updateData.name = name
    if (email) updateData.email = email

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
      runValidators: true,
    })

    console.log(`✅ Perfil atualizado: ${updatedUser.email}`)

    res.json({
      success: true,
      message: "Perfil atualizado com sucesso",
      user: updatedUser.toPublicJSON(),
    })
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error)

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message)
      return res.status(400).json({
        success: false,
        message: "Dados inválidos",
        errors: messages,
      })
    }

    res.status(500).json({
      success: false,
      message: "Erro interno no servidor",
    })
  }
})

// PUT /api/auth/change-password
// Alterar senha
router.put("/change-password", authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Senha atual e nova senha são obrigatórias",
      })
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Nova senha deve ter pelo menos 6 caracteres",
      })
    }

    const User = await getModel("User", "main")

    // Buscar usuário com senha
    const user = await User.findById(req.user._id).select("+password")

    // Verificar senha atual
    const isCurrentPasswordValid = await user.comparePassword(currentPassword)
    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Senha atual incorreta",
      })
    }

    // Atualizar senha
    user.password = newPassword
    await user.save()

    console.log(`✅ Senha alterada: ${user.email}`)

    res.json({
      success: true,
      message: "Senha alterada com sucesso",
    })
  } catch (error) {
    console.error("Erro ao alterar senha:", error)
    res.status(500).json({
      success: false,
      message: "Erro interno no servidor",
    })
  }
})

module.exports = router
