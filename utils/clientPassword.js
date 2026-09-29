// utils/clientPassword.js
//
// Geração e validação de senhas dos usuários de cliente. Compartilhado entre
// as rotas de auth, as rotas de admin e o seeder, para que a política de
// senha exista num lugar só.

const crypto = require("crypto")

const { MIN_PASSWORD_LENGTH } = require("../models/ClientUser")

// Alfabeto sem caracteres ambíguos (0/O, 1/l/I), porque estas senhas são
// distribuídas por telefone e planilha.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
const GENERATED_LENGTH = 14
const GROUP_SIZE = 4

// crypto.randomInt é uniforme — Math.random jamais deve gerar senha.
function generatePassword({ length = GENERATED_LENGTH, grouped = true } = {}) {
  let out = ""
  for (let i = 0; i < length; i++) {
    out += ALPHABET[crypto.randomInt(0, ALPHABET.length)]
  }

  if (!grouped) return out

  // "XXXX-XXXX-XXXX-XX": mais fácil de ditar e conferir
  const groups = []
  for (let i = 0; i < out.length; i += GROUP_SIZE) {
    groups.push(out.slice(i, i + GROUP_SIZE))
  }
  return groups.join("-")
}

// Comprimento mínimo e nada derivado da própria identidade. Sem exigência de
// composição (maiúscula/símbolo/etc.), seguindo NIST 800-63B.
// Retorna a mensagem do problema, ou null se a senha estiver ok.
function validatePassword(password, user = {}) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`
  }

  const lowered = password.toLowerCase()
  const forbidden = [user.login, user.client, user.uf, user.client && user.login ? `${user.client}-${user.login}` : null]

  for (const term of forbidden) {
    if (!term) continue
    const t = String(term).toLowerCase()
    if (t.length >= 2 && lowered.includes(t)) {
      return "Senha não pode conter o login, o cliente ou a UF"
    }
  }

  if (new Set(password).size < 5) {
    return "Senha muito repetitiva"
  }

  return null
}

module.exports = {
  generatePassword,
  validatePassword,
  GENERATED_LENGTH,
}
