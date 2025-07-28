// utils/helpers.js

// Função para criar slug normalizado
function createSlug(text) {
  if (!text || typeof text !== "string") return ""
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove acentos
    .replace(/[^a-z0-9\s-]/g, "") // Remove caracteres especiais
    .replace(/\s+/g, "-") // Substitui espaços por hífens
    .replace(/-+/g, "-") // Remove hífens do início/fim
}

module.exports = {
  createSlug,
}
