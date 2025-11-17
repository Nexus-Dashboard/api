// routes/dataRoutesHybrid.js
const express = require("express");
const router = express.Router();
const { selectDataSource } = require("../middleware/dataSource");

// Controllers híbridos
const hybridController = require("../controllers/questionsControllerHybrid");

// Controllers MongoDB originais (para rotas que ainda não foram migradas)
const questionsController = require("../controllers/questionsController");
const themesController = require("../controllers/themesController");
const searchController = require("../controllers/searchController");
const responsesController = require("../controllers/responsesController");

// Middleware para determinar fonte de dados
router.use((req, res, next) => {
  req.dbKey = req.query.type === "f2f" ? "f2f" : "telephonic";
  next();
});

// Aplicar middleware de seleção de fonte de dados
router.use(selectDataSource());

// ==================== ROTAS HÍBRIDAS (Suportam BigQuery + MongoDB) ====================

// Temas
router.get("/themes", hybridController.getThemes);

// Perguntas
router.get("/questions/all", hybridController.getAllQuestions);
router.get("/question/:questionCode/responses", hybridController.getQuestionResponses);

// Respostas agrupadas
router.post("/question/grouped/responses", hybridController.getGroupedResponses);

// ==================== ROTAS APENAS MONGODB (Ainda não migradas) ====================

router.get("/themes/:themeSlug/questions", themesController.getThemeQuestions);
router.get("/themes/:theme/questions-grouped", themesController.getGroupedQuestions);
router.get("/themes/:theme/questions-summary", themesController.getQuestionsSummary);
router.post("/themes/questions", themesController.postThemeQuestions);

router.get("/question/:questionCode/responses/:questionId", questionsController.getQuestionResponsesById);
router.get("/question/:questionCode/variations", questionsController.getQuestionVariations);
router.get("/question/:questionCode/preview", questionsController.getQuestionPreview);
router.get("/question/:questionCode/smart-search", questionsController.getSmartSearch);
router.get("/question/:questionCode/comparison", questionsController.getQuestionComparison);
router.post("/question/:questionCode/responses", questionsController.postQuestionResponses);

router.get("/search/questions", searchController.searchQuestions);


router.get("/health", async (req, res) => {
  try {
    const { dataSourceMiddleware } = require("../middleware/dataSource");
    const health = await dataSourceMiddleware.healthCheck();
    
    const status = health.mongodb || health.bigquery ? 200 : 503;
    
    res.status(status).json({
      success: true,
      ...health,
      config: {
        USE_BIGQUERY: process.env.USE_BIGQUERY === 'true',
        BIGQUERY_FALLBACK: process.env.BIGQUERY_FALLBACK === 'true',
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
