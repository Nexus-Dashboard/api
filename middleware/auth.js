const jwt = require("jsonwebtoken")
const { getModel } = require("../config/dbManager")

// Middleware de autenticação
const authenticate = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "")

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Token de acesso não fornecido",
      })
    }

    // Verificar e decodificar o token
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // IMPORTANTE: Users sempre no database f2f
    const User = await getModel("User", "f2f")

    // Buscar usuário e selecionar campos necessários
    const user = await User.findById(decoded.id).select("-password")

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Token inválido - usuário não encontrado",
      })
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Conta desativada",
      })
    }

    // Adicionar usuário ao request
    req.user = user
    next()
  } catch (error) {
    console.error("Erro na autenticação:", error)

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Token inválido",
      })
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expirado",
      })
    }

    res.status(500).json({
      success: false,
      message: "Erro interno no servidor",
    })
  }
}

// Middleware para verificar roles específicas
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Acesso negado - usuário não autenticado",
      })
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Acesso negado - requer permissão: ${roles.join(" ou ")}`,
      })
    }

    next()
  }
}

// Middleware opcional de autenticação (não falha se não houver token)
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "")

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      // IMPORTANTE: Users estão no database f2f
      const User = await getModel("User", "f2f")
      const user = await User.findById(decoded.id).select("-password")

      if (user && user.isActive) {
        req.user = user
      }
    }

    next()
  } catch (error) {
    // Ignorar erros de token em autenticação opcional
    next()
  }
}

module.exports = {
  authenticate,
  authorize,
  optionalAuth,
}
