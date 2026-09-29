// routes/clients/authRoutes.js
//
// Autenticação dos usuários dos clientes (SESC / SENAC).
// NÃO existe rota pública de registro: acessos são criados apenas pelo admin
// da Nexus (routes/clients/adminRoutes.js) ou pelo seeder.

const express = require("express")
const bcrypt = require("bcryptjs")

const { getClientUserModel } = require("../../config/clientDb")
const { signClientToken, buildScope, assertScope } = require("../../utils/clientToken")
const { authenticateClient } = require("../../middleware/clientAuth")
const { validatePassword } = require("../../utils/clientPassword")
const { UFS, REGIONS, UF_TO_REGION, UF_LABELS, REGION_LABELS } = require("../../utils/brazilRegions")

const router = express.Router()

// Hash fixo, de uma senha que ninguém usa. Serve para gastar o mesmo tempo de
// bcrypt quando o usuário não existe, eliminando o oráculo de timing que
// routes/authRoutes.js:108-113 tem hoje (lá o retorno é imediato).
const DUMMY_HASH = bcrypt.hashSync("$nexus-dummy-password-para-timing$", 12)

// "sesc-sp" -> { client: "sesc", login: "sp" } (split no PRIMEIRO hífen, para
// que logins com hífen no meio continuem funcionando)
function splitIdentity(identity) {
  if (typeof identity !== "string") return null
  const trimmed = identity.trim().toLowerCase()
  const at = trimmed.indexOf("-")
  if (at <= 0 || at === trimmed.length - 1) return null
  return { client: trimmed.slice(0, at), login: trimmed.slice(at + 1) }
}

// POST /api/clients/auth/login
// Body: { client, login, password } OU { identity: "sesc-sp", password }
router.post("/login", async (req, res) => {
  try {
    const { password } = req.body || {}
    let { client, login } = req.body || {}

    if (!client || !login) {
      const parsed = splitIdentity((req.body || {}).identity)
      if (parsed) {
        client = parsed.client
        login = parsed.login
      }
    }

    if (!client || !login || !password) {
      return res.status(400).json({
        success: false,
        code: "MISSING_FIELDS",
        message: "Informe cliente, login e senha (ou identity e senha)",
      })
    }

    const ClientUser = await getClientUserModel()
    const user = await ClientUser.findOne({
      client: String(client).trim().toLowerCase(),
      login: String(login).trim().toLowerCase(),
    }).select("+password")

    if (!user) {
      // Gasta o mesmo tempo de um compare real antes de responder
      await bcrypt.compare(String(password), DUMMY_HASH)
      return res.status(401).json({
        success: false,
        code: "INVALID_CREDENTIALS",
        message: "Credenciais inválidas",
      })
    }

    if (user.isLocked) {
      return res.status(423).json({
        success: false,
        code: "ACCOUNT_LOCKED",
        message: "Conta temporariamente bloqueada devido a muitas tentativas de login",
      })
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_DISABLED",
        message: "Conta desativada",
      })
    }

    const isPasswordValid = await user.comparePassword(String(password))

    if (!isPasswordValid) {
      await user.incLoginAttempts()
      console.warn(`🔒 Login inválido: ${user.identity} | ip=${req.ip}`)

      return res.status(401).json({
        success: false,
        code: "INVALID_CREDENTIALS",
        message: "Credenciais inválidas",
      })
    }

    await user.resetLoginAttempts()

    const { token, expiresIn } = signClientToken(user)

    console.log(`✅ Login de cliente: ${user.identity} (${user.role}) | ip=${req.ip}`)

    res.json({
      success: true,
      message: "Login realizado com sucesso",
      token,
      expiresIn,
      mustChangePassword: user.mustChangePassword,
      user: user.toPublicJSON(),
      scope: buildScope(user),
    })
  } catch (error) {
    console.error("❌ Erro no login de cliente:", error.message)
    res.status(500).json({
      success: false,
      code: "LOGIN_ERROR",
      message: "Erro interno no servidor",
    })
  }
})

// GET /api/clients/auth/me
router.get("/me", authenticateClient, (req, res) => {
  res.json({
    success: true,
    user: req.clientUser.toPublicJSON(),
    scope: req.clientScope,
  })
})

// POST /api/clients/auth/refresh
// Reemite o token com as claims re-derivadas do banco (não do token antigo)
router.post("/refresh", authenticateClient, (req, res) => {
  try {
    const { token, expiresIn } = signClientToken(req.clientUser)

    res.json({
      success: true,
      message: "Token renovado com sucesso",
      token,
      expiresIn,
      mustChangePassword: req.clientUser.mustChangePassword,
      user: req.clientUser.toPublicJSON(),
      scope: req.clientScope,
    })
  } catch (error) {
    console.error("❌ Erro ao renovar token de cliente:", error.message)
    res.status(500).json({
      success: false,
      code: "REFRESH_ERROR",
      message: "Erro interno no servidor",
    })
  }
})

// PUT /api/clients/auth/change-password
// Devolve um token NOVO: o carimbo passwordChangedAt invalida o anterior.
router.put("/change-password", authenticateClient, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {}

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        code: "MISSING_FIELDS",
        message: "Senha atual e nova senha são obrigatórias",
      })
    }

    const ClientUser = await getClientUserModel()
    const user = await ClientUser.findById(req.clientUser._id).select("+password")

    if (!user) {
      return res.status(404).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "Usuário não encontrado",
      })
    }

    const isCurrentValid = await user.comparePassword(String(currentPassword))
    if (!isCurrentValid) {
      return res.status(401).json({
        success: false,
        code: "INVALID_CREDENTIALS",
        message: "Senha atual incorreta",
      })
    }

    if (String(newPassword) === String(currentPassword)) {
      return res.status(400).json({
        success: false,
        code: "WEAK_PASSWORD",
        message: "A nova senha deve ser diferente da atual",
      })
    }

    const problem = validatePassword(String(newPassword), user)
    if (problem) {
      return res.status(400).json({
        success: false,
        code: "WEAK_PASSWORD",
        message: problem,
      })
    }

    user.password = String(newPassword)
    user.mustChangePassword = false
    await user.save()

    console.log(`🔑 Senha alterada: ${user.identity}`)

    // Token novo, já que o anterior acabou de ser invalidado
    const { token, expiresIn } = signClientToken(user)

    res.json({
      success: true,
      message: "Senha alterada com sucesso",
      token,
      expiresIn,
      user: user.toPublicJSON(),
      scope: buildScope(user),
    })
  } catch (error) {
    console.error("❌ Erro ao alterar senha de cliente:", error.message)
    res.status(500).json({
      success: false,
      code: "CHANGE_PASSWORD_ERROR",
      message: "Erro interno no servidor",
    })
  }
})

// GET /api/clients/auth/scope/check?uf=SP&region=sudeste
// Diagnóstico: não devolve dado nenhum, apenas se o recorte pedido está
// dentro do escopo do usuário. É a prova executável do isolamento.
router.get("/scope/check", authenticateClient, (req, res) => {
  const { uf, region } = req.query
  const allowed = assertScope(req.clientScope, { uf, region })

  if (!allowed) {
    return res.status(403).json({
      success: false,
      code: "OUT_OF_SCOPE",
      message: "Acesso negado - fora do seu escopo de visibilidade",
      requested: { uf: uf || null, region: region || null },
      scope: { allowed: req.clientScope.allowed },
    })
  }

  res.json({
    success: true,
    allowed: true,
    requested: { uf: uf || null, region: region || null },
    level: !uf && !region ? "national" : uf ? "state" : "region",
    scope: { allowed: req.clientScope.allowed },
  })
})

// GET /api/clients/auth/meta/regions
// Para o frontend não hardcodar o mapa de UF -> região
router.get("/meta/regions", authenticateClient, (req, res) => {
  res.json({
    success: true,
    ufs: UFS,
    regions: REGIONS,
    ufToRegion: UF_TO_REGION,
    labels: { ufs: UF_LABELS, regions: REGION_LABELS },
  })
})

module.exports = router
