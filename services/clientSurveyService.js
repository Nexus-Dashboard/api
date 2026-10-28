// services/clientSurveyService.js
//
// Camada de dados das pesquisas dos clientes (SESC / SENAC).
//
// 1. Lê SÓ a aba de códigos da planilha. readGoogleSheetsFile, do
//    googleDriveService, lê todas as abas e guarda cache sem prazo de validade.
// 2. Normaliza os valores (trim, número, UF -> sigla), descarta
//    identificadores e a geografia original.
// 3. Codifica em formato colunar compacto (Uint8/Uint16 em base64).
// 4. Por requisição, aplica a máscara de escopo do usuário: um state_user
//    recebe só um marcador por linha (2 = seu estado, 1 = outro estado da
//    sua região, 0 = fora da região). Nenhuma sigla ou região de terceiros
//    sai daqui. O admin da Nexus recebe a UF de todas as linhas.
//
// Risco residual documentado em docs/CLIENT_SURVEYS.md: os pesos amostrais
// seguem a distribuição regional, então alguém que baixe o payload e faça
// análise estatística consegue inferir aproximadamente a região das linhas
// mascaradas.

const googleAuth = require("../config/googleAuth")
const { UF_LABELS, getRegionSafe, normalizeUF } = require("../utils/brazilRegions")

const CACHE_TTL_MS = 15 * 60 * 1000

const GEO_OUTSIDE = 0
const GEO_REGION = 1
const GEO_STATE = 2

const cache = new Map() // surveyId -> { data, loadedAt }
const inflight = new Map() // surveyId -> Promise

let googleReady = null

function ensureGoogle() {
  if (!googleReady) {
    googleReady = googleAuth.initialize().catch((error) => {
      googleReady = null
      throw error
    })
  }
  return googleReady
}

// "SÃO PAULO" / "Sao Paulo" -> "SAO PAULO"
function foldName(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase()
}

const UF_BY_FOLDED_NAME = Object.freeze(
  Object.fromEntries(Object.entries(UF_LABELS).map(([uf, label]) => [foldName(label), uf])),
)

function parseNumber(value) {
  if (value === "" || value === null || value === undefined) return null
  const parsed = Number(String(value).replace(",", "."))
  return Number.isFinite(parsed) ? parsed : null
}

function toBase64(typedArray) {
  return Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength).toString("base64")
}

// Uint8 quando todos os códigos cabem em 1 byte; senão Uint16 little-endian
function encodeCodes(codes) {
  const max = codes.reduce((acc, value) => (value > acc ? value : acc), 0)
  if (max <= 0xff) return { bits: 8, data: toBase64(Uint8Array.from(codes)) }
  const view = new Uint16Array(codes.length)
  codes.forEach((value, i) => {
    view[i] = value
  })
  return { bits: 16, data: toBase64(view) }
}

function resolveUF(survey, row, index) {
  const { geo } = survey

  for (const column of geo.columns) {
    const raw = row[index[column]]
    if (raw === undefined || raw === "") continue

    if (geo.kind === "ufName") {
      const uf = UF_BY_FOLDED_NAME[foldName(raw)]
      if (uf) return uf
    }

    if (geo.kind === "ufCode") {
      const code = Number.parseInt(raw, 10)
      const uf = geo.codes[code - 1]
      if (uf) return uf
    }

    if (geo.kind === "ufSigla") {
      const uf = normalizeUF(raw)
      if (uf) return uf
    }
  }

  return null
}

// Resposta aberta: agrupa variações de caixa ("SESC", "Sesc") e usa como
// rótulo a grafia mais frequente
function encodeText(values) {
  const groups = new Map() // chave -> { labels: Map<label,count>, index }
  const keys = values.map((raw) => {
    const label = String(raw || "").replace(/\s+/g, " ").trim()
    if (!label) return null
    const key = foldName(label)
    if (!groups.has(key)) groups.set(key, { labels: new Map(), index: groups.size + 1 })
    const counts = groups.get(key).labels
    counts.set(label, (counts.get(label) || 0) + 1)
    return key
  })

  const dictionary = []
  for (const { labels, index } of groups.values()) {
    const [best] = [...labels.entries()].sort((a, b) => b[1] - a[1])
    dictionary[index - 1] = best[0]
  }

  const codes = keys.map((key) => (key ? groups.get(key).index : 0))
  return { values: dictionary, ...encodeCodes(codes) }
}

function buildDataset(survey, rows, meta) {
  const [header = [], ...body] = rows
  const index = Object.fromEntries(header.map((name, i) => [String(name).trim(), i]))

  const missing = [survey.weightColumn, ...survey.geo.columns].filter((column) => index[column] === undefined)
  if (missing.length) {
    const error = new Error(`Colunas obrigatórias ausentes na planilha: ${missing.join(", ")}`)
    error.code = "SURVEY_SCHEMA_ERROR"
    throw error
  }

  // Marcadores de ausência da origem (ex.: "#NULL!" do SPSS) valem como branco
  const nullTokens = new Set(survey.nullTokens || [])
  const cell = (value) => {
    if (value === undefined || value === null) return ""
    const textValue = String(value).trim()
    return nullTokens.has(textValue) ? "" : textValue
  }

  // Sheets corta células vazias no fim da linha: completa até o tamanho do cabeçalho
  const records = body
    .map((row) => header.map((_, i) => cell(row[i])))
    .filter((row) => row.some((value) => value !== ""))

  const excluded = new Set([...survey.dropColumns, survey.weightColumn])
  const numeric = new Set(survey.numericColumns)
  const text = new Set(survey.textColumns)

  const order = []
  const columns = {}
  const warnings = []

  header.forEach((rawName, i) => {
    const name = String(rawName).trim()
    if (!name || excluded.has(name)) return

    const values = records.map((row) => row[i])

    if (text.has(name)) {
      columns[name] = { type: "text", ...encodeText(values) }
    } else if (numeric.has(name)) {
      columns[name] = { type: "num", data: values.map(parseNumber) }
    } else {
      // Aceita códigos gravados como "4,00" / "4.00" (recodificações do SPSS)
      const codes = values.map((value) => (value === "" ? 0 : parseNumber(value) ?? NaN))
      if (codes.every((code) => Number.isInteger(code) && code >= 0 && code <= 0xffff)) {
        columns[name] = { type: "code", ...encodeCodes(codes) }
      } else {
        // Coluna que deveria ser codificada mas veio com texto: não quebra o
        // payload, mas registra para quem mantém a planilha
        warnings.push(name)
        columns[name] = { type: "text", ...encodeText(values) }
      }
    }

    order.push(name)
  })

  const weightIndex = index[survey.weightColumn]
  const weight = records.map((row) => parseNumber(row[weightIndex]) ?? 0)
  const ufs = records.map((row) => resolveUF(survey, row, index))

  const unresolved = ufs.filter((uf) => !uf).length
  if (unresolved) warnings.push(`${unresolved} linha(s) sem UF reconhecida`)
  if (warnings.length) console.warn(`⚠️  Pesquisa ${survey.id}:`, warnings.join("; "))

  return {
    n: records.length,
    order,
    columns,
    weight,
    ufs,
    fileName: meta.fileName,
    modifiedTime: meta.modifiedTime,
    loadedAt: new Date().toISOString(),
  }
}

async function resolveSheetName(sheets, survey) {
  if (survey.sheet) return survey.sheet
  // Sem aba configurada: usa a primeira aba da planilha
  const meta = await sheets.spreadsheets.get({ spreadsheetId: survey.fileId, fields: "sheets.properties.title" })
  return meta.data.sheets[0].properties.title
}

async function fetchSheet(survey) {
  if (!survey.fileId) {
    const error = new Error(`Pesquisa ${survey.id} sem planilha configurada`)
    error.code = "SURVEY_NOT_CONFIGURED"
    throw error
  }

  await ensureGoogle()
  const sheets = googleAuth.getSheets()
  const drive = googleAuth.getDrive()
  const sheetName = await resolveSheetName(sheets, survey)

  const [values, info] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: survey.fileId,
      range: `'${sheetName.replace(/'/g, "''")}'`,
      valueRenderOption: survey.valueRender || "FORMATTED_VALUE",
    }),
    drive.files
      .get({ fileId: survey.fileId, fields: "name, modifiedTime" })
      .then((response) => response.data)
      .catch(() => ({})),
  ])

  return buildDataset(survey, values.data.values || [], {
    fileName: info.name || null,
    modifiedTime: info.modifiedTime || null,
  })
}

async function loadDataset(survey) {
  const cached = cache.get(survey.id)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.data

  if (!inflight.has(survey.id)) {
    const promise = fetchSheet(survey)
      .then((data) => {
        cache.set(survey.id, { data, loadedAt: Date.now() })
        return data
      })
      .finally(() => inflight.delete(survey.id))
    inflight.set(survey.id, promise)
  }

  return inflight.get(survey.id)
}

// Pesquisas de um cliente só são entregues a usuários desse cliente; o admin
// da Nexus enxerga todas
function canAccessSurvey(user, survey) {
  if (!user || !survey) return false
  if (user.role === "nexus_admin") return true
  return user.role === "state_user" && user.client === survey.client
}

function buildGeoMask(ufs, scope) {
  const mask = new Uint8Array(ufs.length)
  ufs.forEach((uf, i) => {
    if (!uf) {
      mask[i] = GEO_OUTSIDE
    } else if (uf === scope.uf) {
      mask[i] = GEO_STATE
    } else if (getRegionSafe(uf) === scope.region) {
      mask[i] = GEO_REGION
    } else {
      mask[i] = GEO_OUTSIDE
    }
  })
  return mask
}

function buildAdminUF(ufs) {
  const values = [...new Set(ufs.filter(Boolean))].sort()
  const position = Object.fromEntries(values.map((uf, i) => [uf, i + 1]))
  return { values, ...encodeCodes(ufs.map((uf) => (uf ? position[uf] : 0))) }
}

// Monta a resposta para UM usuário. Nada do escopo alheio entra no objeto.
function buildPayload(survey, dataset, user, scope) {
  const base = {
    survey: {
      id: survey.id,
      client: survey.client,
      title: survey.title,
      fileName: dataset.fileName,
      modifiedTime: dataset.modifiedTime,
    },
    n: dataset.n,
    order: dataset.order,
    columns: dataset.columns,
    weight: dataset.weight,
    loadedAt: dataset.loadedAt,
    generatedAt: new Date().toISOString(),
  }

  if (user.role === "nexus_admin") {
    return { ...base, scope: { level: "admin" }, uf: buildAdminUF(dataset.ufs) }
  }

  return {
    ...base,
    scope: { level: "state", client: scope.client, uf: scope.uf, region: scope.region },
    geo: { bits: 8, data: toBase64(buildGeoMask(dataset.ufs, scope)) },
  }
}

function clearCache() {
  cache.clear()
}

module.exports = {
  CACHE_TTL_MS,
  buildDataset,
  GEO_OUTSIDE,
  GEO_REGION,
  GEO_STATE,
  loadDataset,
  canAccessSurvey,
  buildPayload,
  buildGeoMask,
  clearCache,
}
