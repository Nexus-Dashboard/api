const express = require("express")
const { getModel } = require("../config/dbManager")
const { authenticate, authorize } = require("../middleware/auth")

const router = express.Router()

// Todas as rotas requerem autenticação
router.use(authenticate)

// GET /api/users
// Listar todos os usuários (apenas admins)
router.get("/", authorize("admin"), async (req, res) => {
  try {
    const { page = 1, limit = 10, search, role, isActive } = req.query

    // CORREÇÃO: Usar await getModel como no authRoutes.js que funciona
    const User = await getModel("User")

    // Construir filtros
    const filters = {}
    if (search) {
      filters.$or = [{ name: { $regex: search, $options: "i" } }, { email: { $regex: search, $options: "i" } }]
    }
    if (role) filters.role = role
    if (isActive !== undefined) filters.isActive = isActive === "true"

    // Paginação
    const skip = (page - 1) * limit
    const total = await User.countDocuments(filters)

    const users = await User.find(filters)
      .select("-password")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number.parseInt(limit))
      .lean()

    res.json({
      success: true,
      data: {
        users: users.map((user) => ({
          ...user,
          id: user._id,
        })),
        pagination: {
          currentPage: Number.parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalUsers: total,
          hasNext: skip + users.length < total,
          hasPrev: page > 1,
        },
      },
    })
  } catch (error) {
    console.error("Erro ao listar usuários:", error)
    res.status(500).json({
      success: false,
      message: "Erro interno no servidor",
    })
  }
})

// GET /api/users/:id
// Obter usuário específico (admins ou próprio usuário)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params

    // Verificar se é admin ou se está acessando próprio perfil
    if (req.user.role !== "admin" && req.user._id.toString() !== id) {
      return res.status(403).json({
        success: false,
        message: "Acesso negado",
      })
    }

    // CORREÇÃO: Usar await getModel
    const User = await getModel("User")
    const user = await User.findById(id).select("-password")

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Usuário não encontrado",
      })
    }

    res.json({
      success: true,
      user: user.toPublicJSON(),
    })
  } catch (error) {
    console.error("Erro ao buscar usuário:", error)
    res.status(500).json({
      success: false,
      message: "Erro interno no servidor",
    })
  }
})

// PUT /api/users/:id
// Atualizar usuário (apenas admins)
router.put("/:id", authorize("admin"), async (req, res) => {
  try {
    const { id } = req.params
    const { name, email, role, isActive } = req.body

    // CORREÇÃO: Usar await getModel
    const User = await getModel("User")

    // Verificar se o usuário existe
    const user = await User.findById(id)
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Usuário não encontrado",
      })
    }

    // Verificar se o email já está em uso por outro usuário
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email, _id: { $ne: id } })
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "Email já está em uso por outro usuário",
        })
      }
    }

    // Preparar dados para atualização
    const updateData = {}
    if (name !== undefined) updateData.name = name
    if (email !== undefined) updateData.email = email
    if (role !== undefined) updateData.role = role
    if (isActive !== undefined) updateData.isActive = isActive

    // Atualizar usuário
    const updatedUser = await User.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).select("-password")

    console.log(`✅ Usuário atualizado: ${updatedUser.email} por ${req.user.email}`)

    res.json({
      success: true,
      message: "Usuário atualizado com sucesso",
      user: updatedUser.toPublicJSON(),
    })
  } catch (error) {
    console.error("Erro ao atualizar usuário:", error)

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

// DELETE /api/users/:id
// Deletar usuário (apenas admins, não pode deletar a si mesmo)
router.delete("/:id", authorize("admin"), async (req, res) => {
  try {
    const { id } = req.params

    // Verificar se não está tentando deletar a si mesmo
    if (req.user._id.toString() === id) {
      return res.status(400).json({
        success: false,
        message: "Você não pode deletar sua própria conta",
      })
    }

    // CORREÇÃO: Usar await getModel
    const User = await getModel("User")
    const user = await User.findById(id)
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Usuário não encontrado",
      })
    }

    await User.findByIdAndDelete(id)

    console.log(`🗑️ Usuário deletado: ${user.email} por ${req.user.email}`)

    res.json({
      success: true,
      message: "Usuário deletado com sucesso",
    })
  } catch (error) {
    console.error("Erro ao deletar usuário:", error)
    res.status(500).json({
      success: false,
      message: "Erro interno no servidor",
    })
  }
})

// POST /api/users/:id/reset-password
// Resetar senha do usuário (apenas admins)
router.post("/:id/reset-password", authorize("admin"), async (req, res) => {
  try {
    const { id } = req.params
    const { newPassword } = req.body

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Nova senha deve ter pelo menos 6 caracteres",
      })
    }

    // CORREÇÃO: Usar await getModel
    const User = await getModel("User")
    const user = await User.findById(id)
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Usuário não encontrado",
      })
    }

    // Atualizar senha
    user.password = newPassword
    await user.save()

    console.log(`🔑 Senha resetada para usuário: ${user.email} por ${req.user.email}`)

    res.json({
      success: true,
      message: "Senha resetada com sucesso",
    })
  } catch (error) {
    console.error("Erro ao resetar senha:", error)
    res.status(500).json({
      success: false,
      message: "Erro interno no servidor",
    })
  }
})

// GET /api/users/stats/overview
// Estatísticas dos usuários (apenas admins)
router.get("/stats/overview", authorize("admin"), async (req, res) => {
  try {
    // CORREÇÃO: Usar await getModel
    const User = await getModel("User")

    const [totalUsers, activeUsers, usersByRole, recentUsers] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      User.aggregate([
        {
          $group: {
            _id: "$role",
            count: { $sum: 1 },
          },
        },
      ]),
      User.find().select("name email role createdAt lastLogin").sort({ createdAt: -1 }).limit(5).lean(),
    ])

    res.json({
      success: true,
      stats: {
        totalUsers,
        activeUsers,
        inactiveUsers: totalUsers - activeUsers,
        usersByRole: usersByRole.reduce((acc, item) => {
          acc[item._id] = item.count
          return acc
        }, {}),
        recentUsers: recentUsers.map((user) => ({
          ...user,
          id: user._id,
        })),
      },
    })
  } catch (error) {
    console.error("Erro ao buscar estatísticas:", error)
    res.status(500).json({
      success: false,
      message: "Erro interno no servidor",
    })
  }
})

module.exports = router
