// routes/dataRoutes.js
const express = require("express")
const router = express.Router()

// Importar controladores modulares
const themesController = require("../controllers/themesController")
const questionsController = require("../controllers/questionsController")
const responsesController = require("../controllers/responsesController")
const searchController = require("../controllers/searchController")

// Função auxiliar para determinar qual banco de dados usar
const getDbKey = (req) => (req.query.type === "f2f" ? "f2f" : "telephonic")

// Middleware para adicionar dbKey ao request
const addDbKey = (req, res, next) => {
  req.dbKey = getDbKey(req)
  next()
}

// Aplicar middleware a todas as rotas
router.use(addDbKey)

// ==================== ROTAS DE TEMAS ====================
router.get("/themes", themesController.getThemes)
router.get("/themes/:themeSlug/questions", themesController.getThemeQuestions)
router.get("/themes/:theme/questions-grouped", themesController.getGroupedQuestions)
router.get("/themes/:theme/questions-summary", themesController.getQuestionsSummary)
router.post("/themes/questions", themesController.postThemeQuestions)

// ==================== ROTAS DE RESPOSTAS (ESPECÍFICAS PRIMEIRO) ====================
// IMPORTANTE: Rotas específicas devem vir ANTES das rotas com parâmetros
router.post("/question/grouped/responses", responsesController.getGroupedResponses)

// ==================== ROTAS DE PERGUNTAS ====================
router.get("/questions/all", questionsController.getAllQuestions)
router.get("/question/:questionCode/responses", questionsController.getQuestionResponses)
router.get("/question/:questionCode/responses/:questionId", questionsController.getQuestionResponsesById)
router.get("/question/:questionCode/variations", questionsController.getQuestionVariations)
router.get("/question/:questionCode/preview", questionsController.getQuestionPreview)
router.get("/question/:questionCode/smart-search", questionsController.getSmartSearch)
router.get("/question/:questionCode/comparison", questionsController.getQuestionComparison)
router.post("/question/:questionCode/responses", questionsController.postQuestionResponses)

// ==================== ROTAS DE BUSCA ====================
router.get("/search/questions", searchController.searchQuestions)

module.exports = router
