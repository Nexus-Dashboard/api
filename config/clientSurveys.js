// config/clientSurveys.js
//
// Registro das pesquisas servidas aos clientes (SESC / SENAC) pela rota
// protegida /api/clients/surveys. Os IDs das planilhas ficam SÓ aqui: o
// front-end nunca os conhece, então não consegue chamar a rota pública
// /api/google/file/:id para baixar a base inteira.
//
// A fonte é a aba "Dados (códigos)": mesmas linhas e colunas da aba de
// respostas, mas com os códigos numéricos do CODEBOOK (4x menor e sem os
// tabs soltos / grafias divergentes da aba de texto). Os rótulos ficam no
// dicionário do dashboard, gerado a partir do CODEBOOK.

// PF3.1 / PF8 (stakeholders): códigos 1-27 do CODEBOOK, em ordem alfabética
// do nome do estado.
const STAKEHOLDER_UF_CODES = Object.freeze([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
])

const SURVEYS = Object.freeze({
  populacao: Object.freeze({
    id: "populacao",
    client: "sesc",
    title: "População geral",
    fileId: "1dSqbnTO_NRydc80Q-hkZ6Lpcc302m_WJ-YgCXOxh5jo",
    sheet: "Dados (códigos)",
    weightColumn: "weights.rf",
    // uf_cotas vem em texto: "SAO PAULO", "DISTRITO FEDERAL"...
    geo: Object.freeze({ kind: "ufName", columns: ["uf_cotas"] }),
    // Respostas abertas (sem rótulo no CODEBOOK), agrupadas sem diferenciar caixa
    textColumns: Object.freeze(["P1"]),
    numericColumns: Object.freeze(["INDICADOR", "GESTÃO", "SOCIAL", "PRODUTOS", "COMUNICAÇÃO"]),
    // Identificadores, geografia original (substituída pela máscara de escopo)
    dropColumns: Object.freeze(["SbjNum", "uf_cotas", "Região"]),
  }),

  stakeholders: Object.freeze({
    id: "stakeholders",
    client: "sesc",
    title: "Stakeholders",
    fileId: "15TQdtTuOWO1Jyhzd8NDC4-hh-EX2xl_tW122uqfstqw",
    sheet: "Dados (códigos)",
    weightColumn: "Peso",
    // PF3.1 é preenchida para Mídia e PF8 para Poder Legislativo
    geo: Object.freeze({ kind: "ufCode", columns: ["PF3.1", "PF8"], codes: STAKEHOLDER_UF_CODES }),
    textColumns: Object.freeze(["P1"]),
    numericColumns: Object.freeze(["INDICADOR", "Gestão", "Impacto_social", "Produtos_serviços", "Comunicacao"]),
    // P14_O é texto livre; os pesos por público estão consolidados em "Peso"
    dropColumns: Object.freeze(["Response_ID", "PF3.1", "PF8", "P14_O", "pesojornalista", "pesoparlamentar"]),
  }),
})

function getSurvey(id) {
  return Object.prototype.hasOwnProperty.call(SURVEYS, id) ? SURVEYS[id] : null
}

function listSurveys() {
  return Object.values(SURVEYS)
}

module.exports = {
  SURVEYS,
  STAKEHOLDER_UF_CODES,
  getSurvey,
  listSurveys,
}
