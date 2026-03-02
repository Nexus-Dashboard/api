// controllers/questionsControllerHybrid.js
const { getModel, getAllModels } = require("../config/dbManager");
const { processSpecificQuestion } = require("../services/questionProcessingService");
const { executeWithFallback } = require("../middleware/dataSource");

/**
 * GET /api/data/question/:questionCode/responses
 * Versão híbrida que suporta MongoDB e BigQuery
 */
const getQuestionResponses = async (req, res) => {
  try {
    const dbKey = req.dbKey;
    const { questionCode } = req.params;
    const { theme, surveyNumber, questionText } = req.query;

    const questionCodeDecoded = decodeURIComponent(questionCode).toUpperCase();

    console.log(`⚡️ Buscando pergunta ${questionCodeDecoded} no tema ${theme} para [${dbKey}]`);

    // Buscar informações da pergunta no MongoDB (sempre)
    const QuestionIndex = await getModel("QuestionIndex", dbKey);
    
    const questionFilters = {
      variable: questionCodeDecoded,
    };

    if (theme) questionFilters.index = theme;
    if (surveyNumber) questionFilters.surveyNumber = surveyNumber.toString();

    const questionInfo = await QuestionIndex.findOne(questionFilters).lean();

    if (!questionInfo) {
      return res.status(404).json({
        success: false,
        type: dbKey,
        message: `Pergunta '${questionCode}' não encontrada com os filtros especificados.`,
      });
    }

    // Buscar perguntas idênticas
    const identicalQuestions = await QuestionIndex.find({
      questionText: questionInfo.questionText,
      variable: questionCodeDecoded,
      index: questionInfo.index,
    }).lean();

    const surveyNumbers = identicalQuestions.map((q) => q.surveyNumber);

    // Executar query com fallback
    const result = await executeWithFallback(
      req,
      // BigQuery function
      async (bigQueryService) => {
        const data = await bigQueryService.getQuestionResponses(
          questionCodeDecoded,
          questionInfo.index,
          surveyNumbers
        );

        return {
          success: true,
          questionCode: questionCodeDecoded,
          questionInfo,
          historicalData: data,
          demographicFields: ['UF', 'Regiao', 'PF1', 'PF2_faixas', 'PF3', 'PF4', 'PF5', 'PF15'],
          availableRounds: surveyNumbers,
        };
      },
      // MongoDB function (fallback)
      async () => {
        const data = await processSpecificQuestion(
          questionInfo,
          questionCodeDecoded,
          questionInfo.index,
          dbKey
        );
        return data;
      }
    );

    // Adicionar metadados
    result.type = dbKey;
    
    res.json(result);
  } catch (error) {
    console.error(`❌ Erro na busca para ${req.params.questionCode}:`, error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    });
  }
};

/**
 * POST /api/data/question/grouped/responses
 * Versão híbrida para respostas agrupadas
 */
const getGroupedResponses = async (req, res) => {
  try {
    const dbKey = req.dbKey;
    const { theme, questionText, variables, baseCode } = req.body;

    if (!theme) {
      return res.status(400).json({
        success: false,
        message: "Campo 'theme' é obrigatório no body da requisição",
      });
    }

    if (!questionText && (!variables || variables.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "É necessário fornecer 'questionText' ou 'variables' no body da requisição",
      });
    }

    console.log(`🎯 [${dbKey}] Buscando respostas agrupadas para tema: ${theme}`);

    // Executar com fallback
    const result = await executeWithFallback(
      req,
      // BigQuery function
      async (bigQueryService) => {
        const data = await bigQueryService.getGroupedResponses(
          theme,
          questionText,
          variables,
          baseCode
        );

        return {
          success: true,
          searchMethod: variables ? "Perguntas múltiplas" : "Agrupado por questionText + theme",
          searchType: variables ? "multiple" : "text-grouped",
          theme,
          questionText: questionText || null,
          baseCode: baseCode || null,
          historicalData: data,
          demographicFields: ['UF', 'Regiao', 'PF1', 'PF2_faixas', 'PF3', 'PF4', 'PF5', 'PF15'],
        };
      },
      // MongoDB function (fallback)
      async () => {
        // Usar o controller original do MongoDB
        const responsesController = require('./responsesController');
        
        // Criar mock de res para capturar resultado
        let mongoResult;
        const mockRes = {
          json: (data) => { mongoResult = data; },
          status: (code) => mockRes,
        };

        await responsesController.getGroupedResponses(req, mockRes);
        return mongoResult;
      }
    );

    result.type = dbKey;
    res.json(result);

  } catch (error) {
    console.error(`❌ Erro na busca agrupada:`, error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    });
  }
};

/**
 * GET /api/data/themes
 * Versão híbrida para listar temas
 */
const getThemes = async (req, res) => {
  try {
    const dbKey = req.dbKey;
    console.log(`🎯 Buscando temas disponíveis para [${dbKey}]...`);

    const result = await executeWithFallback(
      req,
      // BigQuery function
      async (bigQueryService) => {
        const themes = await bigQueryService.getThemes();

        return {
          success: true,
          count: themes.length,
          themes: themes.map(t => ({
            theme: t.theme,
            questionCount: parseInt(t.questionCount),
            Rodadas: t.rounds,
            slug: createSlug(t.theme),
            id: createSlug(t.theme),
          })),
        };
      },
      // MongoDB function (fallback)
      async () => {
        const themesController = require('./themesController');
        
        let mongoResult;
        const mockRes = {
          json: (data) => { mongoResult = data; },
          status: (code) => mockRes,
        };

        await themesController.getThemes(req, mockRes);
        return mongoResult;
      }
    );

    result.type = dbKey;
    res.json(result);

  } catch (error) {
    console.error("❌ Erro ao buscar temas:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    });
  }
};

/**
 * GET /api/data/questions/all
 * Versão híbrida para listar todas as perguntas
 */
const getAllQuestions = async (req, res) => {
  try {
    const dbKey = req.dbKey;
    const { page = 1, limit = 50, search, index: themeFilter } = req.query;

    console.log(`🎯 Buscando todas as perguntas para [${dbKey}]...`);

    const result = await executeWithFallback(
      req,
      // BigQuery function
      async (bigQueryService) => {
        const data = await bigQueryService.getAllQuestionsWithPagination(
          parseInt(page),
          parseInt(limit),
          { search, theme: themeFilter }
        );

        return {
          success: true,
          data: {
            questions: data.questions,
            pagination: data.pagination,
          },
        };
      },
      // MongoDB function (fallback)
      async () => {
        const questionsController = require('./questionsController');
        
        let mongoResult;
        const mockRes = {
          json: (data) => { mongoResult = data; },
          status: (code) => mockRes,
        };

        await questionsController.getAllQuestions(req, mockRes);
        return mongoResult;
      }
    );

    result.type = dbKey;
    res.json(result);

  } catch (error) {
    console.error("❌ Erro ao buscar perguntas:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    });
  }
};

// Helper function
function createSlug(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

module.exports = {
  getQuestionResponses,
  getGroupedResponses,
  getThemes,
  getAllQuestions,
};