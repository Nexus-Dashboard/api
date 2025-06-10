// services/googleDriveService.js
const googleAuth = require('../config/googleAuth');
const XLSX = require('xlsx');

class GoogleDriveService {
  constructor() {
    this.drive = null;
    this.sheets = null;
    this.rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID; // ID da pasta "Telefônicas"
  }

  async initialize() {
    await googleAuth.initialize();
    this.drive = googleAuth.getDrive();
    this.sheets = googleAuth.getSheets();
  }

  // Buscar pasta raiz "Telefônicas" se não tiver ID configurado
  async findRootFolder() {
    try {
      const response = await this.drive.files.list({
        q: "name='Telefônicas' and mimeType='application/vnd.google-apps.folder'",
        fields: 'files(id, name)'
      });

      if (response.data.files.length > 0) {
        this.rootFolderId = response.data.files[0].id;
        console.log('Pasta Telefônicas encontrada:', this.rootFolderId);
        return this.rootFolderId;
      } else {
        throw new Error('Pasta "Telefônicas" não encontrada no Drive');
      }
    } catch (error) {
      console.error('Erro ao buscar pasta raiz:', error);
      throw error;
    }
  }

  // Listar estrutura completa do Drive
  async listDriveStructure() {
    try {
      if (!this.rootFolderId) {
        await this.findRootFolder();
      }

      const structure = await this._getFolderStructure(this.rootFolderId, 'Telefônicas');
      return structure;
    } catch (error) {
      console.error('Erro ao listar estrutura:', error);
      throw error;
    }
  }

  // Função recursiva para mapear estrutura de pastas
  async _getFolderStructure(folderId, folderName, level = 0) {
    const response = await this.drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, modifiedTime, size)',
      orderBy: 'name'
    });

    const structure = {
      id: folderId,
      name: folderName,
      type: 'folder',
      level: level,
      children: []
    };

    for (const file of response.data.files) {
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        // É uma pasta - buscar recursivamente
        const subFolder = await this._getFolderStructure(file.id, file.name, level + 1);
        structure.children.push(subFolder);
      } else {
        // É um arquivo
        structure.children.push({
          id: file.id,
          name: file.name,
          type: 'file',
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime,
          size: file.size,
          level: level + 1
        });
      }
    }

    return structure;
  }

  // Listar apenas arquivos de pesquisa (.xlsx/.xlsm)
  async listSurveyFiles() {
    try {
      if (!this.rootFolderId) {
        await this.findRootFolder();
      }

      const files = await this._getAllSurveyFiles(this.rootFolderId);
      return this._organizeSurveyFiles(files);
    } catch (error) {
      console.error('Erro ao listar arquivos de pesquisa:', error);
      throw error;
    }
  }

  async _getAllSurveyFiles(folderId, path = '') {
    const response = await this.drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, modifiedTime, parents)',
      orderBy: 'name'
    });

    let allFiles = [];

    for (const file of response.data.files) {
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        const newPath = path ? `${path}/${file.name}` : file.name;
        const subFiles = await this._getAllSurveyFiles(file.id, newPath);
        allFiles = allFiles.concat(subFiles);
      } else if (this._isSurveyFile(file.name)) {
        allFiles.push({
          ...file,
          path: path,
          category: this._categorizeFile(file.name, path)
        });
      }
    }

    return allFiles;
  }

  _isSurveyFile(fileName) {
    const extensions = ['.xlsx', '.xlsm', '.xls'];
    return extensions.some(ext => fileName.toLowerCase().endsWith(ext));
  }

  _categorizeFile(fileName, path) {
    const lowerName = fileName.toLowerCase();
    const lowerPath = path.toLowerCase();

    if (lowerName.includes('dicionário') || lowerName.includes('dicionario') || 
        lowerPath.includes('dicionário') || lowerPath.includes('dicionario')) {
      return 'dictionary';
    }
    
    if (lowerName.includes('bd') || lowerName.includes('tracking') || lowerName.includes('rodada')) {
      return 'database';
    }

    return 'other';
  }

  _organizeSurveyFiles(files) {
    const organized = {
      databases: [],
      dictionaries: [],
      byYear: {},
      total: files.length
    };

    files.forEach(file => {
      // Extrair ano do caminho
      const yearMatch = file.path.match(/\b(20\d{2})\b/);
      const year = yearMatch ? yearMatch[1] : 'unknown';

      if (!organized.byYear[year]) {
        organized.byYear[year] = {
          databases: [],
          dictionaries: [],
          other: []
        };
      }

      if (file.category === 'database') {
        organized.databases.push(file);
        organized.byYear[year].databases.push(file);
      } else if (file.category === 'dictionary') {
        organized.dictionaries.push(file);
        organized.byYear[year].dictionaries.push(file);
      } else {
        organized.byYear[year].other.push(file);
      }
    });

    return organized;
  }

  // Baixar e ler arquivo Excel
  async readExcelFile(fileId) {
    try {
      const response = await this.drive.files.get({
        fileId: fileId,
        alt: 'media'
      });

      const workbook = XLSX.read(response.data, { type: 'buffer' });
      
      const result = {
        fileId: fileId,
        sheets: workbook.SheetNames,
        data: {}
      };

      workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        result.data[sheetName] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      });

      return result;
    } catch (error) {
      console.error('Erro ao ler arquivo Excel:', error);
      throw error;
    }
  }

  // Converter Excel para Google Sheets
  async convertToGoogleSheets(fileId, targetFolderId = null) {
    try {
      // 1. Baixar o arquivo Excel
      const fileResponse = await this.drive.files.get({
        fileId: fileId,
        alt: 'media'
      });

      // 2. Obter metadados do arquivo original
      const metadataResponse = await this.drive.files.get({
        fileId: fileId,
        fields: 'name, parents'
      });

      const originalName = metadataResponse.data.name;
      const newName = originalName.replace(/\.(xlsx?|xlsm)$/i, '') + ' (Sheets)';

      // 3. Criar novo Google Sheets
      const createResponse = await this.drive.files.create({
        requestBody: {
          name: newName,
          parents: targetFolderId ? [targetFolderId] : metadataResponse.data.parents,
          mimeType: 'application/vnd.google-apps.spreadsheet'
        },
        media: {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          body: fileResponse.data
        }
      });

      console.log(`Arquivo convertido: ${originalName} -> ${newName}`);
      return {
        originalFileId: fileId,
        newFileId: createResponse.data.id,
        originalName: originalName,
        newName: newName,
        url: `https://docs.google.com/spreadsheets/d/${createResponse.data.id}`
      };
    } catch (error) {
      console.error('Erro ao converter para Google Sheets:', error);
      throw error;
    }
  }

  // Extrair dados específicos de uma pergunta em todos os arquivos
  async extractQuestionData(questionCode, year = null) {
    try {
      const surveyFiles = await this.listSurveyFiles();
      const results = [];

      // Filtrar por ano se especificado
      const filesToProcess = year 
        ? (surveyFiles.byYear[year]?.databases || [])
        : surveyFiles.databases;

      for (const file of filesToProcess) {
        try {
          const excelData = await this.readExcelFile(file.id);
          
          // Procurar a pergunta em todas as sheets
          for (const [sheetName, sheetData] of Object.entries(excelData.data)) {
            if (sheetData.length > 0) {
              const headers = sheetData[0];
              const questionIndex = headers.findIndex(header => 
                header && header.toString().toLowerCase() === questionCode.toLowerCase()
              );

              if (questionIndex !== -1) {
                const questionData = sheetData.slice(1).map(row => ({
                  idEntrevista: row[0], // Assumindo que a primeira coluna é sempre o ID
                  [questionCode]: row[questionIndex],
                  // Incluir dados demográficos básicos se disponíveis
                  uf: row[headers.findIndex(h => h === 'UF')] || null,
                  regiao: row[headers.findIndex(h => h === 'REGIAO')] || null,
                  data: row[headers.findIndex(h => h === 'DATA')] || null
                })).filter(item => item[questionCode] != null);

                results.push({
                  fileId: file.id,
                  fileName: file.name,
                  year: file.path.match(/\b(20\d{2})\b/)?.[1] || 'unknown',
                  sheetName: sheetName,
                  questionCode: questionCode,
                  totalResponses: questionData.length,
                  data: questionData
                });
              }
            }
          }
        } catch (fileError) {
          console.error(`Erro ao processar arquivo ${file.name}:`, fileError);
        }
      }

      return {
        questionCode: questionCode,
        year: year,
        totalFiles: filesToProcess.length,
        filesWithData: results.length,
        totalResponses: results.reduce((sum, result) => sum + result.totalResponses, 0),
        results: results
      };
    } catch (error) {
      console.error('Erro ao extrair dados da pergunta:', error);
      throw error;
    }
  }
}

module.exports = GoogleDriveService;