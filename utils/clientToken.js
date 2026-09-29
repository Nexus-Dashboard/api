// utils/clientToken.js
//
// Emissão e verificação do JWT dos clientes (SESC / SENAC).
//
// O token é AUTOCONTIDO: carrega o escopo de visibilidade materializado, para
// que a camada que serve os dados (planilha/Excel/outra API) decida sozinha o
// que liberar, sem reimplementar o mapa de regiões e sem chamar esta API a
// cada requisição. O contrato está em docs/CLIENT_TOKEN_CONTRACT.md.
//
// O segredo é DIFERENTE do JWT_SECRET da Secom — é isso que garante que um
// token da Secom nunca abra um recurso de cliente, e vice-versa.

const jwt = require("jsonwebtoken")

const { ROLE_NEXUS_ADMIN, ROLE_STATE_USER } = require("../models/ClientUser")

// Versão do contrato de claims. Se o formato mudar de maneira incompatível,
// incrementar aqui invalida os tokens antigos de forma explícita.
const TOKEN_VERSION = 1
const TOKEN_TYPE = "client"

const DEFAULT_EXPIRES_IN = "8h"
const DEFAULT_ISSUER = "nexus-api"
const DEFAULT_AUDIENCE = "nexus-clients"

function getIssuer() {
  return process.env.CLIENT_JWT_ISSUER || DEFAULT_ISSUER
}

function getAudience() {
  return process.env.CLIENT_JWT_AUDIENCE || DEFAULT_AUDIENCE
}

function getExpiresIn() {
  return process.env.CLIENT_JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN
}

// Asserção em runtime do isolamento: se alguém configurar o mesmo segredo dos
// dois lados, a separação entre Secom e clientes deixaria de existir em
// silêncio. Melhor não subir.
function getClientSecret() {
  const secret = process.env.CLIENT_JWT_SECRET

  if (!secret) {
    throw new Error(
      "CLIENT_JWT_SECRET não está definida. O módulo de clientes exige um segredo próprio, " +
        "distinto do JWT_SECRET da Secom (ver docs/CLIENT_AUTH_ENV.md).",
    )
  }

  if (process.env.JWT_SECRET && secret === process.env.JWT_SECRET) {
    throw new Error(
      "CLIENT_JWT_SECRET é igual a JWT_SECRET. Os segredos precisam ser distintos, senão um token " +
        "da Secom passaria a valer nas rotas de cliente. Gere outro com: " +
        "node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
    )
  }

  return secret
}

// Escopo de visibilidade materializado. `allowed` é a lista pronta para o
// consumidor fazer includes() — ele não precisa conhecer o mapa IBGE.
function buildScope(user) {
  if (user.role === ROLE_NEXUS_ADMIN) {
    return {
      level: "admin",
      client: user.client,
      uf: null,
      region: null,
      scopes: ["users:read", "users:write"],
      allowed: null, // admin da Nexus não é consumidor de dado de pesquisa
    }
  }

  return {
    level: "state",
    client: user.client,
    uf: user.uf,
    region: user.region,
    scopes: ["data:national", "data:region", "data:state"],
    allowed: {
      national: true,
      regions: [user.region],
      ufs: [user.uf],
    },
  }
}

// Payload do JWT. Nunca inclui hash de senha, tentativas de login, bloqueio,
// e-mail, id da Secom ou qualquer dado de pesquisa.
function buildClaims(user) {
  const scope = buildScope(user)

  return {
    sub: String(user._id),
    typ: TOKEN_TYPE,
    ver: TOKEN_VERSION,
    client: user.client,
    login: user.login,
    identity: `${user.client}-${user.login}`,
    name: user.name,
    role: user.role,
    uf: user.uf || null,
    region: user.region || null,
    scopes: scope.scopes,
    allowed: scope.allowed,
  }
}

function signClientToken(user) {
  const expiresIn = getExpiresIn()

  const token = jwt.sign(buildClaims(user), getClientSecret(), {
    algorithm: "HS256",
    expiresIn,
    issuer: getIssuer(),
    audience: getAudience(),
  })

  // Devolve também os segundos até expirar, para o frontend agendar o refresh
  const decoded = jwt.decode(token)
  return { token, expiresIn: decoded.exp - decoded.iat }
}

// `algorithms` explícito fecha a confusão de algoritmo / alg:none.
function verifyClientToken(token) {
  const decoded = jwt.verify(token, getClientSecret(), {
    algorithms: ["HS256"],
    issuer: getIssuer(),
    audience: getAudience(),
    clockTolerance: 5,
  })

  if (decoded.typ !== TOKEN_TYPE) {
    throw new jwt.JsonWebTokenError("Token não é de cliente")
  }

  if (decoded.ver !== TOKEN_VERSION) {
    throw new jwt.JsonWebTokenError(`Versão de token não suportada: ${decoded.ver}`)
  }

  return decoded
}

// Regra de autorização compartilhada com a camada de dados.
//
// Interseciona o filtro PEDIDO com o filtro PERMITIDO. Ausência de filtro
// significa consulta nacional — nunca "tudo".
function assertScope(scope, filters = {}) {
  if (!scope) return false

  const { uf, region } = filters

  // Admin da Nexus não consome dado de pesquisa
  if (!scope.allowed) return false

  if (!uf && !region) {
    return scope.allowed.national === true
  }

  if (uf) {
    const wanted = String(uf).trim().toUpperCase()
    if (!scope.allowed.ufs.includes(wanted)) return false
  }

  if (region) {
    const wanted = String(region).trim().toLowerCase()
    if (!scope.allowed.regions.includes(wanted)) return false
  }

  return true
}

module.exports = {
  TOKEN_VERSION,
  TOKEN_TYPE,
  getClientSecret,
  getIssuer,
  getAudience,
  getExpiresIn,
  buildScope,
  buildClaims,
  signClientToken,
  verifyClientToken,
  assertScope,
}
