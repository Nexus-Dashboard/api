// middleware/clientAuth.js
//
// Autenticação dos clientes SESC / SENAC. Separado de middleware/auth.js
// (Secom) por cinco motivos, todos bloqueantes:
//   1. auth.js:17 usa process.env.JWT_SECRET — um token da Secom passaria a
//      abrir rota de cliente, exatamente o que este módulo precisa impedir;
//   2. auth.js:20 usa getModel("User", "f2f") — model e banco errados;
//   3. o contrato de payload de lá é { id }, sem cliente, papel nem escopo;
//   4. de lá não há checagem de bloqueio nem de revogação por troca de senha;
//   5. parametrizar auth.js mudaria o fluxo da Secom.

const jwt = require("jsonwebtoken")

const { getClientUserModel } = require("../config/clientDb")
const { verifyClientToken, buildScope, assertScope } = require("../utils/clientToken")
const { ROLE_NEXUS_ADMIN } = require("../models/ClientUser")

function extractBearer(req) {
  const header = req.header("Authorization") || req.header("authorization")
  if (!header) return null

  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

const authenticateClient = async (req, res, next) => {
  try {
    const token = extractBearer(req)

    if (!token) {
      return res.status(401).json({
        success: false,
        code: "NO_TOKEN",
        message: "Token de acesso não fornecido",
      })
    }

    const decoded = verifyClientToken(token)

    const ClientUser = await getClientUserModel()
    const user = await ClientUser.findById(decoded.sub)

    if (!user) {
      return res.status(401).json({
        success: false,
        code: "INVALID_TOKEN",
        message: "Token inválido - usuário não encontrado",
      })
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        code: "ACCOUNT_DISABLED",
        message: "Conta desativada",
      })
    }

    if (user.isLocked) {
      return res.status(401).json({
        success: false,
        code: "ACCOUNT_LOCKED",
        message: "Conta temporariamente bloqueada",
      })
    }

    // Revogação: troca ou reset de senha derruba os tokens emitidos antes.
    // jwt guarda iat em segundos; a margem de 1s evita falso positivo quando
    // token e carimbo caem no mesmo segundo.
    if (user.passwordChangedAt && decoded.iat * 1000 < user.passwordChangedAt.getTime() - 1000) {
      return res.status(401).json({
        success: false,
        code: "TOKEN_STALE",
        message: "Token expirado por troca de senha. Faça login novamente.",
      })
    }

    // O admin pode ter mudado a UF ou o papel depois da emissão do token —
    // nesse caso o escopo do token está velho e precisa ser reemitido.
    if (decoded.client !== user.client || decoded.role !== user.role || (decoded.uf || null) !== (user.uf || null)) {
      return res.status(401).json({
        success: false,
        code: "TOKEN_STALE",
        message: "Permissões alteradas. Faça login novamente.",
      })
    }

    req.clientUser = user
    // Escopo SEMPRE re-derivado do documento, nunca lido das claims: dentro
    // desta API nenhuma decisão de autorização depende do que veio no token.
    req.clientScope = buildScope(user)
    req.clientToken = decoded

    next()
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        success: false,
        code: "TOKEN_EXPIRED",
        message: "Token expirado",
      })
    }

    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        success: false,
        code: "INVALID_TOKEN",
        message: "Token inválido",
      })
    }

    console.error("❌ Erro na autenticação de cliente:", error.message)
    return res.status(500).json({
      success: false,
      code: "AUTH_ERROR",
      message: "Erro interno no servidor",
    })
  }
}

const authorizeClient = (...roles) => {
  return (req, res, next) => {
    if (!req.clientUser) {
      return res.status(401).json({
        success: false,
        code: "NOT_AUTHENTICATED",
        message: "Acesso negado - usuário não autenticado",
      })
    }

    if (!roles.includes(req.clientUser.role)) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Acesso negado - permissão insuficiente",
      })
    }

    next()
  }
}

const requireNexusAdmin = authorizeClient(ROLE_NEXUS_ADMIN)

// Recusa uma requisição que peça UF ou região fora do escopo do usuário.
// A regra é a mesma que a camada de dados deve aplicar: intersecionar o
// filtro pedido com o permitido; ausência de filtro é consulta nacional.
const scopeGuard = (options = {}) => {
  const { ufParam = "uf", regionParam = "region" } = options

  return (req, res, next) => {
    const scope = req.clientScope

    if (!scope) {
      return res.status(401).json({
        success: false,
        code: "NOT_AUTHENTICATED",
        message: "Acesso negado - usuário não autenticado",
      })
    }

    const uf = req.query[ufParam] || (req.body && req.body[ufParam])
    const region = req.query[regionParam] || (req.body && req.body[regionParam])

    if (!assertScope(scope, { uf, region })) {
      return res.status(403).json({
        success: false,
        code: "OUT_OF_SCOPE",
        message: "Acesso negado - fora do seu escopo de visibilidade",
        scope: {
          allowed: scope.allowed,
        },
      })
    }

    next()
  }
}

module.exports = {
  authenticateClient,
  authorizeClient,
  requireNexusAdmin,
  scopeGuard,
}
