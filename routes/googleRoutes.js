

// routes/googleRoutes.js
const express = require('express');
const router = express.Router();
const GoogleDriveService = require('../services/googleDriveService');
const connectDB = require('../config/db');

// Instância do serviço
const driveService = new GoogleDriveService();
let serviceInitialized = false;

// Middleware para garantir que o serviço esteja inicializado
const ensureServiceInitialized = async (req, res, next) => {
  try {
    if (!serviceInitialized) {
      await driveService.initialize();
      serviceInitialized = true;
    }
    next();
  } catch (error) {
    console.error('Erro ao inicializar serviço Google:', error);
    res.status(500).json({ 
      error: 'Erro ao conectar com Google Drive',
      details: error.message 
    });
  }
};

// GET /api/google/structure
// Lista toda a estrutura de pastas e arquivos do Drive
router.get('/structure', ensureServiceInitialized, async (req, res) => {
  try {
    const structure = await driveService.listDriveStructure();
    res.json({
      success: true,
      structure: structure
    });
  } catch (error) {
    console.error('Erro ao listar estrutura:', error);
    res.status(500).json({ 
      error: 'Erro ao listar estrutura do Drive',
      details: error.message 
    });
  }
});

// GET /api/google/surveys
// Lista apenas arquivos de pesquisa organizados
router.get('/surveys', ensureServiceInitialized, async (req, res) => {
  try {
    const surveys = await driveService.listSurveyFiles();
    res.json({
      success: true,
      surveys: surveys
    });
  } catch (error) {
    console.error('Erro ao listar arquivos de pesquisa:', error);
    res.status(500).json({ 
      error: 'Erro ao listar arquivos de pesquisa',
      details: error.message 
    });
  }
});

// GET /api/google/file/:fileId
// Lê conteúdo de um arquivo específico
router.get('/file/:fileId', ensureServiceInitialized, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { sheet } = req.query; // Parâmetro opcional para sheet específica

    const fileData = await driveService.readExcelFile(fileId);
    
    // Se solicitou sheet específica, retorna apenas ela
    if (sheet && fileData.data[sheet]) {
      res.json({
        success: true,
        fileId: fileId,
        sheet: sheet,
        data: fileData.data[sheet]
      });
    } else {
      res.json({
        success: true,
        fileData: fileData
      });
    }
  } catch (error) {
    console.error('Erro ao ler arquivo:', error);
    res.status(500).json({ 
      error: 'Erro ao ler arquivo',
      details: error.message 
    });
  }
});

// POST /api/google/convert/:fileId
// Converte arquivo Excel para Google Sheets
router.post('/convert/:fileId', ensureServiceInitialized, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { targetFolderId } = req.body; // Pasta de destino opcional

    const result = await driveService.convertToGoogleSheets(fileId, targetFolderId);
    
    res.json({
      success: true,
      conversion: result
    });
  } catch (error) {
    console.error('Erro ao converter arquivo:', error);
    res.status(500).json({ 
      error: 'Erro ao converter arquivo',
      details: error.message 
    });
  }
});

// POST /api/google/convert/batch
// Converte múltiplos arquivos de uma vez
router.post('/convert/batch', ensureServiceInitialized, async (req, res) => {
  try {
    const { fileIds, targetFolderId } = req.body;

    if (!Array.isArray(fileIds)) {
      return res.status(400).json({ 
        error: 'fileIds deve ser um array' 
      });
    }

    const results = [];
    const errors = [];

    for (const fileId of fileIds) {
      try {
        const result = await driveService.convertToGoogleSheets(fileId, targetFolderId);
        results.push(result);
      } catch (error) {
        errors.push({
          fileId: fileId,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      totalRequested: fileIds.length,
      successful: results.length,
      failed: errors.length,
      results: results,
      errors: errors
    });
  } catch (error) {
    console.error('Erro na conversão em lote:', error);
    res.status(500).json({ 
      error: 'Erro na conversão em lote',
      details: error.message 
    });
  }
});

// GET /api/google/question/:questionCode
// Extrai dados específicos de uma pergunta
router.get('/question/:questionCode', ensureServiceInitialized, async (req, res) => {
  try {
    const { questionCode } = req.params;
    const { year, format } = req.query;

    const questionData = await driveService.extractQuestionData(questionCode, year);
    
    // Se solicitou formato agregado
    if (format === 'aggregated') {
      const aggregated = aggregateQuestionData(questionData);
      res.json({
        success: true,
        questionData: aggregated
      });
    } else {
      res.json({
        success: true,
        questionData: questionData
      });
    }
  } catch (error) {
    console.error('Erro ao extrair dados da pergunta:', error);
    res.status(500).json({ 
      error: 'Erro ao extrair dados da pergunta',
      details: error.message 
    });
  }
});

// POST /api/google/import-to-db
// Importa dados do Drive para o banco de dados MongoDB
router.post('/import-to-db', ensureServiceInitialized, async (req, res) => {
  try {
    await connectDB();
    
    const { fileId, surveyName, year, month } = req.body;

    if (!fileId || !surveyName) {
      return res.status(400).json({
        error: 'fileId e surveyName são obrigatórios'
      });
    }

    // Ler dados do arquivo
    const fileData = await driveService.readExcelFile(fileId);
    
    // Converter dados para formato do banco
    const Survey = require('../models/Survey');
    const Response = require('../models/Response');

    for (const [sheetName, sheetData] of Object.entries(fileData.data)) {
      if (sheetData.length > 1) { // Tem header e dados
        const headers = sheetData[0];
        const rows = sheetData.slice(1);

        // Criar/atualizar survey
        const variables = headers.map(header => ({
          key: header,
          label: header,
          type: 'text' // Pode ser refinado baseado no conteúdo
        }));

        const survey = await Survey.findOneAndUpdate(
          { name: `${surveyName}_${sheetName}` },
          {
            name: `${surveyName}_${sheetName}`,
            month: month,
            year: year ? parseInt(year) : null,
            variables: variables
          },
          { upsert: true, new: true }
        );

        // Inserir respostas
        const responses = rows.map(row => {
          const answers = headers.map((header, index) => ({
            key: header,
            value: row[index]
          }));

          return {
            surveyId: survey._id,
            entrevistadoId: row[0] ? String(row[0]) : `temp_${Date.now()}_${Math.random()}`,
            answers: answers
          };
        });

        await Response.insertMany(responses);
      }
    }

    res.json({
      success: true,
      message: 'Dados importados com sucesso',
      fileId: fileId,
      surveyName: surveyName
    });

  } catch (error) {
    console.error('Erro ao importar dados:', error);
    res.status(500).json({ 
      error: 'Erro ao importar dados para o banco',
      details: error.message 
    });
  }
});

// Função auxiliar para agregar dados de pergunta
function aggregateQuestionData(questionData) {
  const aggregated = {
    questionCode: questionData.questionCode,
    year: questionData.year,
    totalResponses: questionData.totalResponses,
    byYear: {},
    byRegion: {},
    byUF: {},
    responseDistribution: {}
  };

  questionData.results.forEach(result => {
    const year = result.year;
    
    if (!aggregated.byYear[year]) {
      aggregated.byYear[year] = {
        totalResponses: 0,
        responses: []
      };
    }

    result.data.forEach(response => {
      aggregated.byYear[year].totalResponses++;
      aggregated.byYear[year].responses.push(response[questionData.questionCode]);

      // Agregar por região
      if (response.regiao) {
        if (!aggregated.byRegion[response.regiao]) {
          aggregated.byRegion[response.regiao] = [];
        }
        aggregated.byRegion[response.regiao].push(response[questionData.questionCode]);
      }

      // Agregar por UF
      if (response.uf) {
        if (!aggregated.byUF[response.uf]) {
          aggregated.byUF[response.uf] = [];
        }
        aggregated.byUF[response.uf].push(response[questionData.questionCode]);
      }

      // Distribuição de respostas
      const responseValue = response[questionData.questionCode];
      if (responseValue) {
        if (!aggregated.responseDistribution[responseValue]) {
          aggregated.responseDistribution[responseValue] = 0;
        }
        aggregated.responseDistribution[responseValue]++;
      }
    });
  });

  return aggregated;
}

module.exports = router;