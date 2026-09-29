// routes/clients/surveyRoutes.js
//
// Dados das pesquisas dos clientes (SESC / SENAC), montado em
// /api/clients/surveys. Toda rota exige o token de cliente, e a máscara de
// escopo é aplicada no servidor (services/clientSurveyService.js). O
// contrato está em docs/CLIENT_SURVEYS.md.

const express = require("express")

const { authenticateClient } = require("../../middleware/clientAuth")
const { getSurvey, listSurveys } = require("../../config/clientSurveys")
const { loadDataset, canAccessSurvey, buildPayload } = require("../../services/clientSurveyService")

const router = express.Router()

router.use(authenticateClient)

// GET /api/clients/surveys
// Pesquisas que o usuário pode abrir (sem IDs de planilha)
router.get("/", (req, res) => {
  const surveys = listSurveys()
    .filter((survey) => canAccessSurvey(req.clientUser, survey))
    .map((survey) => ({ id: survey.id, client: survey.client, title: survey.title }))

  res.json({ success: true, surveys })
})

// GET /api/clients/surveys/:surveyId/data
router.get("/:surveyId/data", async (req, res) => {
  const survey = getSurvey(req.params.surveyId)

  if (!survey) {
    return res.status(404).json({
      success: false,
      code: "SURVEY_NOT_FOUND",
      message: "Pesquisa não encontrada",
    })
  }

  if (!canAccessSurvey(req.clientUser, survey)) {
    return res.status(403).json({
      success: false,
      code: "SURVEY_FORBIDDEN",
      message: "Acesso negado - esta pesquisa não pertence ao seu cliente",
    })
  }

  if (req.clientUser.role !== "nexus_admin" && (!req.clientScope.uf || !req.clientScope.region)) {
    return res.status(403).json({
      success: false,
      code: "OUT_OF_SCOPE",
      message: "Acesso negado - usuário sem UF definida",
    })
  }

  try {
    const dataset = await loadDataset(survey)
    const payload = buildPayload(survey, dataset, req.clientUser, req.clientScope)

    // Resposta por usuário: nunca em cache compartilhado
    res.set("Cache-Control", "private, max-age=300")
    res.set("Vary", "Authorization")
    return res.json({ success: true, ...payload })
  } catch (error) {
    console.error(`❌ Erro ao carregar a pesquisa ${survey.id}:`, error.message)
    return res.status(502).json({
      success: false,
      code: error.code === "SURVEY_SCHEMA_ERROR" ? "SURVEY_SCHEMA_ERROR" : "SURVEY_SOURCE_ERROR",
      message: "Não foi possível carregar os dados da pesquisa. Tente novamente em instantes.",
    })
  }
})

module.exports = router
