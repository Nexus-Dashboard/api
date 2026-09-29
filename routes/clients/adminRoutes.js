// routes/clients/adminRoutes.js
//
// Gestão dos usuários dos clientes — exclusiva do admin da Nexus.
// Não existe DELETE: desativação é isActive:false, preservando a auditoria.

const express = require("express")

const { getClientUserModel } = require("../../config/clientDb")
const { authenticateClient, requireNexusAdmin } = require("../../middleware/clientAuth")
const { generatePassword, validatePassword } = require("../../utils/clientPassword")
const { UFS, REGIONS, normalizeUF, normalizeRegion, getUFsByRegion } = require("../../utils/brazilRegions")
const { CLIENT_CODES, ROLES, ROLE_STATE_USER } = require("../../models/ClientUser")

const router = express.Router()

router.use(authenticateClient, requireNexusAdmin)

// routes/userRoutes.js:22 monta o regex de busca sem escapar — um "(" na
// query derruba a rota. Aqui a entrada do usuário é escapada.
function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function handleMongoError(res, error, context) {
  if (error && error.code === 11000) {
    return res.status(409).json({
      success: false,
      code: "DUPLICATE_LOGIN",
      message: "Já existe um usuário com este login para este cliente",
    })
  }

  if (error && error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Dados inválidos",
      errors: Object.values(error.errors).map((e) => e.message),
    })
  }

  console.error(`❌ ${context}:`, error.message)
  return res.status(500).json({
    success: false,
    code: "SERVER_ERROR",
    message: "Erro interno no servidor",
  })
}

// GET /api/clients/users/stats/overview
// DEVE vir antes de /users/:id, senão "stats" é capturado como id
router.get("/stats/overview", async (req, res) => {
  try {
    const ClientUser = await getClientUserModel()

    const [total, active, byClient, byRole, byRegion, neverLoggedIn, locked] = await Promise.all([
      ClientUser.countDocuments(),
      ClientUser.countDocuments({ isActive: true }),
      ClientUser.aggregate([{ $group: { _id: "$client", count: { $sum: 1 } } }]),
      ClientUser.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
      ClientUser.aggregate([
        { $match: { region: { $ne: null } } },
        { $group: { _id: { client: "$client", region: "$region" }, count: { $sum: 1 } } },
        { $sort: { "_id.client": 1, "_id.region": 1 } },
      ]),
      ClientUser.countDocuments({ lastLogin: { $exists: false } }),
      ClientUser.countDocuments({ lockUntil: { $gt: new Date() } }),
    ])

    const toMap = (rows) =>
      rows.reduce((acc, row) => {
        acc[row._id] = row.count
        return acc
      }, {})

    res.json({
      success: true,
      stats: {
        totalUsers: total,
        activeUsers: active,
        inactiveUsers: total - active,
        lockedUsers: locked,
        neverLoggedIn,
        byClient: toMap(byClient),
        byRole: toMap(byRole),
        byRegion: byRegion.map((row) => ({
          client: row._id.client,
          region: row._id.region,
          count: row.count,
        })),
      },
    })
  } catch (error) {
    handleMongoError(res, error, "Erro ao gerar estatísticas de usuários de cliente")
  }
})

// GET /api/clients/users?page&limit&client&uf&region&role&isActive&search
router.get("/", async (req, res) => {
  try {
    const { page = 1, limit = 30, client, uf, region, role, isActive, search } = req.query

    const filters = {}

    if (client) filters.client = String(client).trim().toLowerCase()
    if (role) filters.role = String(role).trim()
    if (isActive !== undefined) filters.isActive = isActive === "true"

    if (uf) {
      const normalized = normalizeUF(uf)
      if (!normalized) {
        return res.status(400).json({ success: false, code: "INVALID_UF", message: `UF inválida: ${uf}` })
      }
      filters.uf = normalized
    }

    if (region) {
      const normalized = normalizeRegion(region)
      if (!normalized) {
        return res.status(400).json({ success: false, code: "INVALID_REGION", message: `Região inválida: ${region}` })
      }
      filters.region = normalized
    }

    if (search) {
      const safe = escapeRegex(search)
      filters.$or = [{ login: { $regex: safe, $options: "i" } }, { name: { $regex: safe, $options: "i" } }]
    }

    const parsedLimit = Math.min(Math.max(Number.parseInt(limit) || 30, 1), 200)
    const parsedPage = Math.max(Number.parseInt(page) || 1, 1)
    const skip = (parsedPage - 1) * parsedLimit

    const ClientUser = await getClientUserModel()
    const [total, users] = await Promise.all([
      ClientUser.countDocuments(filters),
      ClientUser.find(filters).sort({ client: 1, uf: 1, login: 1 }).skip(skip).limit(parsedLimit),
    ])

    res.json({
      success: true,
      data: {
        users: users.map((u) => u.toPublicJSON()),
        pagination: {
          currentPage: parsedPage,
          totalPages: Math.ceil(total / parsedLimit),
          totalUsers: total,
          hasNext: skip + users.length < total,
          hasPrev: parsedPage > 1,
        },
      },
    })
  } catch (error) {
    handleMongoError(res, error, "Erro ao listar usuários de cliente")
  }
})

// GET /api/clients/users/:id
router.get("/:id", async (req, res) => {
  try {
    const ClientUser = await getClientUserModel()
    const user = await ClientUser.findById(req.params.id)

    if (!user) {
      return res.status(404).json({ success: false, code: "USER_NOT_FOUND", message: "Usuário não encontrado" })
    }

    res.json({ success: true, user: user.toPublicJSON() })
  } catch (error) {
    handleMongoError(res, error, "Erro ao buscar usuário de cliente")
  }
})

// POST /api/clients/users
// Body: { client, login, name, uf, role?, password? }
// `region` NÃO é aceita: é derivada da UF pelo model.
router.post("/", async (req, res) => {
  try {
    const body = req.body || {}

    if ("region" in body) {
      return res.status(400).json({
        success: false,
        code: "DERIVED_FIELD",
        message: "O campo 'region' é derivado da UF e não pode ser informado",
      })
    }

    const { client, login, name, uf, role = ROLE_STATE_USER, password } = body

    if (!client || !login || !name) {
      return res.status(400).json({
        success: false,
        code: "MISSING_FIELDS",
        message: "Campos obrigatórios: client, login, name",
      })
    }

    if (!CLIENT_CODES.includes(String(client).trim().toLowerCase())) {
      return res.status(400).json({
        success: false,
        code: "INVALID_CLIENT",
        message: `Cliente inválido: ${client}. Esperado um de: ${CLIENT_CODES.join(", ")}`,
      })
    }

    if (!ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ROLE",
        message: `Papel inválido: ${role}. Esperado um de: ${ROLES.join(", ")}`,
      })
    }

    // Senha gerada é devolvida UMA única vez, nesta resposta
    const generated = !password
    const finalPassword = generated ? generatePassword() : String(password)

    if (!generated) {
      const problem = validatePassword(finalPassword, { client, login, uf })
      if (problem) {
        return res.status(400).json({ success: false, code: "WEAK_PASSWORD", message: problem })
      }
    }

    const ClientUser = await getClientUserModel()
    const user = new ClientUser({
      client,
      login,
      name,
      uf,
      role,
      password: finalPassword,
      mustChangePassword: true,
      createdBy: req.clientUser._id,
      updatedBy: req.clientUser._id,
    })

    await user.save()

    console.log(`✅ Acesso criado: ${user.identity} (${user.role}) por ${req.clientUser.identity}`)

    res.status(201).json({
      success: true,
      message: "Usuário criado com sucesso",
      user: user.toPublicJSON(),
      ...(generated && {
        temporaryPassword: finalPassword,
        warning: "Esta senha é exibida uma única vez. Envie por canal seguro.",
      }),
    })
  } catch (error) {
    handleMongoError(res, error, "Erro ao criar usuário de cliente")
  }
})

// PUT /api/clients/users/:id
// Só { name, uf, role, isActive }. client/login são imutáveis; region é derivada.
// Usa findById + save() para que o hook de derivação de região rode.
router.put("/:id", async (req, res) => {
  try {
    const body = req.body || {}

    if ("region" in body) {
      return res.status(400).json({
        success: false,
        code: "DERIVED_FIELD",
        message: "O campo 'region' é derivado da UF e não pode ser informado",
      })
    }

    const immutable = ["client", "login"].filter((f) => f in body)
    if (immutable.length > 0) {
      return res.status(400).json({
        success: false,
        code: "IMMUTABLE_FIELD",
        message: `Campo imutável não pode ser alterado: ${immutable.join(", ")}`,
      })
    }

    const ClientUser = await getClientUserModel()
    const user = await ClientUser.findById(req.params.id)

    if (!user) {
      return res.status(404).json({ success: false, code: "USER_NOT_FOUND", message: "Usuário não encontrado" })
    }

    if (String(user._id) === String(req.clientUser._id) && body.isActive === false) {
      return res.status(400).json({
        success: false,
        code: "SELF_DEACTIVATION",
        message: "Você não pode desativar sua própria conta",
      })
    }

    const { name, uf, role, isActive } = body
    if (name !== undefined) user.name = name
    if (uf !== undefined) user.uf = uf
    if (role !== undefined) user.role = role
    if (isActive !== undefined) user.isActive = isActive
    user.updatedBy = req.clientUser._id

    await user.save()

    console.log(`✅ Acesso atualizado: ${user.identity} por ${req.clientUser.identity}`)

    res.json({ success: true, message: "Usuário atualizado com sucesso", user: user.toPublicJSON() })
  } catch (error) {
    handleMongoError(res, error, "Erro ao atualizar usuário de cliente")
  }
})

// PATCH /api/clients/users/:id/status  { isActive }
// Substitui o DELETE: nada é apagado.
router.patch("/:id/status", async (req, res) => {
  try {
    const { isActive } = req.body || {}

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        code: "MISSING_FIELDS",
        message: "Campo 'isActive' (boolean) é obrigatório",
      })
    }

    const ClientUser = await getClientUserModel()
    const user = await ClientUser.findById(req.params.id)

    if (!user) {
      return res.status(404).json({ success: false, code: "USER_NOT_FOUND", message: "Usuário não encontrado" })
    }

    if (String(user._id) === String(req.clientUser._id) && !isActive) {
      return res.status(400).json({
        success: false,
        code: "SELF_DEACTIVATION",
        message: "Você não pode desativar sua própria conta",
      })
    }

    user.isActive = isActive
    user.updatedBy = req.clientUser._id
    await user.save()

    console.log(
      `${isActive ? "✅ Acesso reativado" : "🚫 Acesso desativado"}: ${user.identity} por ${req.clientUser.identity}`,
    )

    res.json({
      success: true,
      message: isActive ? "Usuário reativado com sucesso" : "Usuário desativado com sucesso",
      user: user.toPublicJSON(),
    })
  } catch (error) {
    handleMongoError(res, error, "Erro ao alterar status de usuário de cliente")
  }
})

// POST /api/clients/users/:id/reset-password  { newPassword? }
// Invalida os tokens ativos do usuário (via passwordChangedAt no model).
router.post("/:id/reset-password", async (req, res) => {
  try {
    const { newPassword } = req.body || {}

    const ClientUser = await getClientUserModel()
    const user = await ClientUser.findById(req.params.id).select("+password")

    if (!user) {
      return res.status(404).json({ success: false, code: "USER_NOT_FOUND", message: "Usuário não encontrado" })
    }

    const generated = !newPassword
    const finalPassword = generated ? generatePassword() : String(newPassword)

    if (!generated) {
      const problem = validatePassword(finalPassword, user)
      if (problem) {
        return res.status(400).json({ success: false, code: "WEAK_PASSWORD", message: problem })
      }
    }

    user.password = finalPassword
    user.mustChangePassword = true
    user.updatedBy = req.clientUser._id
    await user.save()

    // Uma senha nova também merece destravar a conta
    await user.unlock()

    console.log(`🔑 Senha resetada: ${user.identity} por ${req.clientUser.identity}`)

    res.json({
      success: true,
      message: "Senha resetada com sucesso. Os tokens ativos deste usuário foram invalidados.",
      user: user.toPublicJSON(),
      ...(generated && {
        temporaryPassword: finalPassword,
        warning: "Esta senha é exibida uma única vez. Envie por canal seguro.",
      }),
    })
  } catch (error) {
    handleMongoError(res, error, "Erro ao resetar senha de usuário de cliente")
  }
})

// POST /api/clients/users/:id/unlock
// Necessária porque o login é público por construção e o lockout é DoS-ável.
router.post("/:id/unlock", async (req, res) => {
  try {
    const ClientUser = await getClientUserModel()
    const user = await ClientUser.findById(req.params.id)

    if (!user) {
      return res.status(404).json({ success: false, code: "USER_NOT_FOUND", message: "Usuário não encontrado" })
    }

    await user.unlock()

    console.log(`🔓 Conta destravada: ${user.identity} por ${req.clientUser.identity}`)

    res.json({ success: true, message: "Conta destravada com sucesso" })
  } catch (error) {
    handleMongoError(res, error, "Erro ao destravar usuário de cliente")
  }
})

// GET /api/clients/users/meta/expected-logins?client=sesc
// Ajuda a conferir quais dos 27 acessos estaduais ainda faltam criar.
router.get("/meta/expected-logins", async (req, res) => {
  try {
    const { client } = req.query

    if (!client || !CLIENT_CODES.includes(String(client).trim().toLowerCase())) {
      return res.status(400).json({
        success: false,
        code: "INVALID_CLIENT",
        message: `Informe ?client= com um de: ${CLIENT_CODES.join(", ")}`,
      })
    }

    const normalizedClient = String(client).trim().toLowerCase()

    const ClientUser = await getClientUserModel()
    const existing = await ClientUser.find({ client: normalizedClient, role: ROLE_STATE_USER }).select("uf login")

    const existingUFs = new Set(existing.map((u) => u.uf))

    res.json({
      success: true,
      client: normalizedClient,
      expected: UFS.length,
      created: existing.length,
      missing: UFS.filter((uf) => !existingUFs.has(uf)),
      byRegion: REGIONS.map((region) => ({
        region,
        total: getUFsByRegion(region).length,
        created: getUFsByRegion(region).filter((uf) => existingUFs.has(uf)).length,
      })),
    })
  } catch (error) {
    handleMongoError(res, error, "Erro ao conferir acessos esperados")
  }
})

module.exports = router
