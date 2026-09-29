// models/ClientUser.js
//
// Usuários dos clientes SESC / SENAC — separados dos usuários da Secom
// (models/User.js), que vivem no banco f2f e são autenticados por e-mail.
// Aqui a credencial é um login institucional por estado (ex.: "sesc-sp").
//
// IMPORTANTE: este arquivo NÃO chama mongoose.model(). Ele exporta apenas o
// schema, que é compilado na conexão do banco de clientes por
// config/clientDb.js. Registrar no registry global do mongoose (como
// models/User.js:125 faz) traria risco de OverwriteModelError sem ganho algum.

const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")

const { UFS, REGIONS, assertUF, getRegion } = require("../utils/brazilRegions")

// "nexus" é o cliente interno: identifica os admins da Nexus, que administram
// SESC e SENAC e nunca recebem escopo de dados.
const CLIENT_CODES = Object.freeze(["sesc", "senac", "nexus"])
const DATA_CLIENT_CODES = Object.freeze(["sesc", "senac"])

const ROLE_NEXUS_ADMIN = "nexus_admin"
const ROLE_STATE_USER = "state_user"
const ROLES = Object.freeze([ROLE_NEXUS_ADMIN, ROLE_STATE_USER])

const MAX_LOGIN_ATTEMPTS = 5

// 15 minutos, e não as 2h de models/User.js:96. Aqui os logins são públicos
// por construção ("sesc-sp" é adivinhável), então um bloqueio longo viraria
// um DoS trivial contra um estado inteiro. Compensado pela rota de unlock
// do admin (POST /api/clients/users/:id/unlock).
const LOCK_MS = 15 * 60 * 1000

const MIN_PASSWORD_LENGTH = 12

// Aceita letras minúsculas, dígitos, ponto, hífen e underscore. Precisa
// começar com alfanumérico e ter no máximo 31 caracteres.
const LOGIN_PATTERN = /^[a-z0-9][a-z0-9._-]{0,30}$/

const ClientUserSchema = new mongoose.Schema(
  {
    client: {
      type: String,
      required: [true, "Cliente é obrigatório"],
      enum: { values: [...CLIENT_CODES], message: "Cliente inválido: {VALUE}" },
      lowercase: true,
      trim: true,
      immutable: true,
    },
    login: {
      type: String,
      required: [true, "Login é obrigatório"],
      lowercase: true,
      trim: true,
      match: [LOGIN_PATTERN, "Login inválido: use apenas letras minúsculas, números, ponto, hífen ou underscore"],
      immutable: true,
    },
    name: {
      type: String,
      required: [true, "Nome é obrigatório"],
      trim: true,
      maxlength: [120, "Nome não pode ter mais de 120 caracteres"],
    },
    password: {
      type: String,
      required: [true, "Senha é obrigatória"],
      minlength: [MIN_PASSWORD_LENGTH, `Senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`],
      select: false, // Por padrão, não incluir a senha nas consultas
    },
    role: {
      type: String,
      enum: { values: [...ROLES], message: "Papel inválido: {VALUE}" },
      default: ROLE_STATE_USER,
    },
    uf: {
      type: String,
      uppercase: true,
      trim: true,
      enum: { values: [...UFS], message: "UF inválida: {VALUE}" },
      required: [
        function () {
          return this.role === ROLE_STATE_USER
        },
        "UF é obrigatória para usuário estadual",
      ],
    },
    // Derivada da UF pelo hook pre("validate"). NUNCA aceita de input.
    region: {
      type: String,
      enum: { values: [...REGIONS], message: "Região inválida: {VALUE}" },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Senha inicial/resetada precisa ser trocada no primeiro acesso
    mustChangePassword: {
      type: Boolean,
      default: true,
    },
    // Tokens emitidos antes desta data são recusados por middleware/clientAuth.js
    passwordChangedAt: {
      type: Date,
    },
    lastLogin: {
      type: Date,
    },
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClientUser",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClientUser",
    },
  },
  {
    timestamps: true,
  },
)

// Unicidade é do PAR cliente+login: "sesc/sp" e "senac/sp" coexistem.
// Um índice único em `login` sozinho quebraria isso.
ClientUserSchema.index({ client: 1, login: 1 }, { unique: true, name: "uniq_client_login" })
ClientUserSchema.index({ client: 1, uf: 1 })
ClientUserSchema.index({ role: 1, isActive: 1 })

// Virtual para verificar se a conta está bloqueada
ClientUserSchema.virtual("isLocked").get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now())
})

// Identificador usado no login de campo único e nos logs: "sesc-sp"
ClientUserSchema.virtual("identity").get(function () {
  return `${this.client}-${this.login}`
})

// ÚNICO lugar do sistema que escreve `region`. Roda antes da validação, de
// modo que qualquer `region` que tenha vindo do body é sobrescrita — nunca
// rejeitada silenciosamente nem aproveitada.
ClientUserSchema.pre("validate", function (next) {
  try {
    if (typeof this.client === "string") this.client = this.client.trim().toLowerCase()
    if (typeof this.login === "string") this.login = this.login.trim().toLowerCase()

    if (this.role === ROLE_STATE_USER) {
      this.uf = assertUF(this.uf)
      this.region = getRegion(this.uf)
    } else {
      // Admin da Nexus não tem recorte geográfico
      this.uf = undefined
      this.region = undefined
    }

    next()
  } catch (error) {
    next(error)
  }
})

// Rede de segurança: campos derivados/imutáveis não podem ser alterados por
// update direto, que não dispara o hook de derivação acima. As rotas usam
// findById + save() justamente para evitar isso, mas código futuro pode não.
const GUARDED_FIELDS = ["region", "client", "login"]

ClientUserSchema.pre(["findOneAndUpdate", "updateOne", "updateMany"], function (next) {
  const update = this.getUpdate() || {}
  const touched = GUARDED_FIELDS.filter(
    (field) => Object.prototype.hasOwnProperty.call(update, field) || (update.$set && field in update.$set),
  )

  if (touched.length > 0) {
    return next(
      new Error(
        `Campo derivado/imutável não pode ser atualizado: ${touched.join(", ")}. ` +
          `Use findById + save() para que a derivação de região seja aplicada.`,
      ),
    )
  }

  next()
})

// Hash da senha antes de salvar (mesmo padrão de models/User.js:62-74)
ClientUserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next()

  try {
    const salt = await bcrypt.genSalt(12)
    this.password = await bcrypt.hash(this.password, salt)

    // Em documento novo não faz sentido invalidar token nenhum; em troca de
    // senha, este carimbo é o que derruba as sessões abertas.
    if (!this.isNew) {
      this.passwordChangedAt = new Date()
    }

    next()
  } catch (error) {
    next(error)
  }
})

ClientUserSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false
  return await bcrypt.compare(candidatePassword, this.password)
}

ClientUserSchema.methods.incLoginAttempts = function () {
  // Bloqueio expirado: recomeça a contagem do zero
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 },
    })
  }

  const updates = { $inc: { loginAttempts: 1 } }

  if (this.loginAttempts + 1 >= MAX_LOGIN_ATTEMPTS && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + LOCK_MS }
  }

  return this.updateOne(updates)
}

ClientUserSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({
    $unset: { loginAttempts: 1, lockUntil: 1 },
    $set: { lastLogin: new Date() },
  })
}

ClientUserSchema.methods.unlock = function () {
  return this.updateOne({
    $unset: { loginAttempts: 1, lockUntil: 1 },
  })
}

// Representação pública — nunca inclui senha, e expõe o estado de bloqueio
// para o painel do admin.
ClientUserSchema.methods.toPublicJSON = function () {
  return {
    id: this._id,
    client: this.client,
    login: this.login,
    identity: this.identity,
    name: this.name,
    role: this.role,
    uf: this.uf || null,
    region: this.region || null,
    isActive: this.isActive,
    mustChangePassword: this.mustChangePassword,
    isLocked: this.isLocked,
    lastLogin: this.lastLogin || null,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  }
}

module.exports = {
  ClientUserSchema,
  CLIENT_CODES,
  DATA_CLIENT_CODES,
  ROLES,
  ROLE_NEXUS_ADMIN,
  ROLE_STATE_USER,
  MAX_LOGIN_ATTEMPTS,
  LOCK_MS,
  MIN_PASSWORD_LENGTH,
  LOGIN_PATTERN,
}
