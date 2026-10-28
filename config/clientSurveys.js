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

// Códigos 1-27 dos CODEBOOKs, em ordem alfabética do nome do estado. Usado
// por PF3.1 / PF8 (Sesc stakeholders) e PF4 (Senac população).
const ALPHABETICAL_UF_CODES = Object.freeze([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
])
const STAKEHOLDER_UF_CODES = ALPHABETICAL_UF_CODES

// Senac: as bases vêm do SPSS, só com códigos. O Google Sheets é lido com
// UNFORMATTED_VALUE (pesos e indicadores com precisão total, sem depender da
// formatação da planilha) e "#NULL!" (missing do SPSS) vira branco. Sem aba
// definida, a API lê a primeira aba da planilha.
// "#NULO!" é o mesmo missing quando a base passa por um Excel em português.
const SENAC_SOURCE = Object.freeze({ valueRender: "UNFORMATTED_VALUE", nullTokens: Object.freeze(["#NULL!", "#NULO!"]) })

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
    geo: Object.freeze({ kind: "ufCode", columns: ["PF3.1", "PF8"], codes: ALPHABETICAL_UF_CODES }),
    textColumns: Object.freeze(["P1"]),
    numericColumns: Object.freeze(["INDICADOR", "Gestão", "Impacto_social", "Produtos_serviços", "Comunicacao"]),
    // P14_O é texto livre; os pesos por público estão consolidados em "Peso"
    dropColumns: Object.freeze(["Response_ID", "PF3.1", "PF8", "P14_O", "pesojornalista", "pesoparlamentar"]),
  }),

  "senac-populacao": Object.freeze({
    id: "senac-populacao",
    client: "senac",
    title: "População geral",
    // Planilha Google convertida de "Pesquisa SENAC - Base ponderada_indicadores - Dash.xlsx"
    fileId: "1DNe5rI30u1ADNRJJWL2hphZiW1cl6ONQqb_-ImkBe48",
    sheet: "base",
    ...SENAC_SOURCE,
    weightColumn: "weights.rf",
    // PF4: códigos 1-27 em ordem alfabética do nome do estado
    geo: Object.freeze({ kind: "ufCode", columns: ["PF4"], codes: ALPHABETICAL_UF_CODES }),
    textColumns: Object.freeze([]),
    numericColumns: Object.freeze([
      "PF2",
      "Gestao_Governanca_valido",
      "Impacto_Social_valido",
      "Excelencia_valido",
      "Educacao_a_distancia_valido",
      "Comunicacao_valido",
      "Futuro_do_trabalho_valido",
      "Indicador_Geral_valido",
      "Gestao_Governanca_sempeso",
      "Impacto_Social_sempeso",
      "Excelencia_sempeso",
      "Educacao_a_distancia_sempeso",
      "Comunicacao_sempeso",
      "Futuro_do_Trabalho_sempeso",
    ]),
    // PF5 é o código IBGE da cidade (revelaria a UF); PF3_3_OUT e Q_79_S são texto livre
    dropColumns: Object.freeze(["SbjNum", "PF4", "PF5", "Regiao", "PF3_3_OUT", "Q_79_S"]),
  }),

  "senac-empresarios": Object.freeze({
    id: "senac-empresarios",
    client: "senac",
    title: "Empresários",
    // Planilha Google convertida de "EMPRESARIOS Base SENAC - ponderada - onda 1 - EAD_DASH.xlsx"
    fileId: "1fvJAe1pVFmsWjXTyFy8Eb6XOHha-vLcMMZpGHwU2g6c",
    sheet: "base",
    ...SENAC_SOURCE,
    weightColumn: "weights",
    // PF7_1: sigla da UF ("SP", "CE"...)
    geo: Object.freeze({ kind: "ufSigla", columns: ["PF7_1"] }),
    textColumns: Object.freeze([]),
    numericColumns: Object.freeze(["PF5_t"]),
    // PF6 é a região; PF8_* identificam a cidade; PF2_1 é o CNAE; *_t são texto livre
    dropColumns: Object.freeze(["idEntrevista", "PF7_1", "PF6", "PF8_cod_1", "PF8_1", "PF2_1", "PF1_t", "P14_6_t"]),
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
  ALPHABETICAL_UF_CODES,
  STAKEHOLDER_UF_CODES,
  getSurvey,
  listSurveys,
}
