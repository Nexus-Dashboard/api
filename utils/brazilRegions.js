// utils/brazilRegions.js
//
// Mapa fixo das 27 unidades federativas (26 estados + DF) para as 5 regiões
// do IBGE. É a ÚNICA fonte de verdade da região de um usuário estadual:
// a região nunca é aceita de input, é sempre derivada da UF (ver o hook
// pre("validate") em models/ClientUser.js).
//
// As regiões são gravadas em slug (sem acento, com hífen) para atravessarem
// URL, JWT e planilha sem escape. O rótulo humano fica em REGION_LABELS.

const NORTE = "norte"
const NORDESTE = "nordeste"
const CENTRO_OESTE = "centro-oeste"
const SUDESTE = "sudeste"
const SUL = "sul"

const REGIONS = Object.freeze([NORTE, NORDESTE, CENTRO_OESTE, SUDESTE, SUL])

const UF_TO_REGION = Object.freeze({
  // Norte (7)
  AC: NORTE,
  AP: NORTE,
  AM: NORTE,
  PA: NORTE,
  RO: NORTE,
  RR: NORTE,
  TO: NORTE,
  // Nordeste (9)
  AL: NORDESTE,
  BA: NORDESTE,
  CE: NORDESTE,
  MA: NORDESTE,
  PB: NORDESTE,
  PE: NORDESTE,
  PI: NORDESTE,
  RN: NORDESTE,
  SE: NORDESTE,
  // Centro-Oeste (4)
  DF: CENTRO_OESTE,
  GO: CENTRO_OESTE,
  MT: CENTRO_OESTE,
  MS: CENTRO_OESTE,
  // Sudeste (4)
  ES: SUDESTE,
  MG: SUDESTE,
  RJ: SUDESTE,
  SP: SUDESTE,
  // Sul (3)
  PR: SUL,
  RS: SUL,
  SC: SUL,
})

const UFS = Object.freeze(Object.keys(UF_TO_REGION).sort())

const UF_LABELS = Object.freeze({
  AC: "Acre",
  AL: "Alagoas",
  AM: "Amazonas",
  AP: "Amapá",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MG: "Minas Gerais",
  MS: "Mato Grosso do Sul",
  MT: "Mato Grosso",
  PA: "Pará",
  PB: "Paraíba",
  PE: "Pernambuco",
  PI: "Piauí",
  PR: "Paraná",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RO: "Rondônia",
  RR: "Roraima",
  RS: "Rio Grande do Sul",
  SC: "Santa Catarina",
  SE: "Sergipe",
  SP: "São Paulo",
  TO: "Tocantins",
})

const REGION_LABELS = Object.freeze({
  [NORTE]: "Norte",
  [NORDESTE]: "Nordeste",
  [CENTRO_OESTE]: "Centro-Oeste",
  [SUDESTE]: "Sudeste",
  [SUL]: "Sul",
})

// "sp" / " SP " -> "SP"; qualquer coisa que não seja UF válida -> null
function normalizeUF(value) {
  if (!value || typeof value !== "string") return null
  const uf = value.trim().toUpperCase()
  return UF_TO_REGION[uf] ? uf : null
}

function isValidUF(value) {
  return normalizeUF(value) !== null
}

// Versão que lança — usada nos hooks do model, onde uma UF inválida
// jamais pode passar silenciosamente.
function assertUF(value) {
  const uf = normalizeUF(value)
  if (!uf) {
    throw new Error(`UF inválida: ${JSON.stringify(value)}. Esperado uma das 27: ${UFS.join(", ")}`)
  }
  return uf
}

function getRegion(uf) {
  return UF_TO_REGION[assertUF(uf)]
}

function getRegionSafe(uf) {
  const normalized = normalizeUF(uf)
  return normalized ? UF_TO_REGION[normalized] : null
}

function normalizeRegion(value) {
  if (!value || typeof value !== "string") return null
  const region = value.trim().toLowerCase()
  return REGIONS.includes(region) ? region : null
}

function isValidRegion(value) {
  return normalizeRegion(value) !== null
}

function getUFsByRegion(region) {
  const normalized = normalizeRegion(region)
  if (!normalized) return []
  return UFS.filter((uf) => UF_TO_REGION[uf] === normalized)
}

module.exports = {
  UFS,
  REGIONS,
  UF_TO_REGION,
  UF_LABELS,
  REGION_LABELS,
  normalizeUF,
  isValidUF,
  assertUF,
  getRegion,
  getRegionSafe,
  normalizeRegion,
  isValidRegion,
  getUFsByRegion,
}
