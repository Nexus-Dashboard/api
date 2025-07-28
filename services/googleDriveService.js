// services/googleDriveService.js
const googleAuth = require("../config/googleAuth")

class GoogleDriveService {
  constructor() {
    this.drive = null
    this.sheets = null
    // IDs para pesquisas TELEFONICAS
    this.rootFolderId = "1PA_g6SLCYe_VIn5L7sT7a2CqOOu3v01b"

    // IDs para pesquisas F2F (Face-to-Face)
    this.f2fRootFolderId = "1_reWHktzuuOZ_NaNhYkZsSolfa3-2kbi"
    this.f2fYearFolderIds = {
      2023: "1QjkQMMuFDBxim7izUK1pdWhOUD1NST8_",
      2024: "1TCJ4Oz36-o7iEVmv1zCipk3cst1e7SD7",
      2025: "1o_gZ_oGjbVST4XvWFYC9Ta3OfjCcmVs0",
    }

    // Cache para melhorar performance
    this.cache = {
      yearFolders: null,
      allSurveyFiles: null,
      allF2FSurveyFiles: null, // Novo cache para F2F
      fileData: new Map(),
      questionData: new Map(),
      lastUpdate: null,
    }

    // Configurações de performance
    this.CACHE_DURATION = 5 * 60 * 1000 // 5 minutos
    this.MAX_CONCURRENT_FILES = 5 // Processar 5 arquivos em paralelo
  }

  async initialize() {
    await googleAuth.initialize()
    this.drive = googleAuth.getDrive()
    this.sheets = googleAuth.getSheets()
  }

  _isCacheValid() {
    return this.cache.lastUpdate && Date.now() - this.cache.lastUpdate < this.CACHE_DURATION
  }

  clearCache() {
    this.cache = {
      yearFolders: null,
      allSurveyFiles: null,
      allF2FSurveyFiles: null,
      fileData: new Map(),
      questionData: new Map(),
      lastUpdate: null,
    }
  }

  async listYearFolders() {
    try {
      if (this.cache.yearFolders && this._isCacheValid()) {
        return this.cache.yearFolders
      }

      const response = await this.drive.files.list({
        q: `'${this.rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(id, name, modifiedTime)",
        orderBy: "name",
      })

      const yearFolders = response.data.files
        .filter((folder) => /^20\d{2}$/.test(folder.name))
        .sort((a, b) => b.name.localeCompare(a.name))

      this.cache.yearFolders = yearFolders
      this.cache.lastUpdate = Date.now()
      return yearFolders
    } catch (error) {
      console.error("Erro ao listar pastas de anos:", error)
      throw error
    }
  }

  async listSurveyFilesInYear(yearFolderId) {
    try {
      const response = await this.drive.files.list({
        q: `'${yearFolderId}' in parents and trashed=false and name contains '(Google Sheets)' and name contains 'BD - TRACKING - RODADA'`,
        fields: "files(id, name, mimeType, modifiedTime)",
        orderBy: "name",
      })
      return response.data.files.filter((file) => file.mimeType === "application/vnd.google-apps.spreadsheet")
    } catch (error) {
      console.error("Erro ao listar arquivos de pesquisa:", error)
      throw error
    }
  }

  // NOVO: Método para listar arquivos de pesquisa F2F em uma pasta de ano
  async listSurveyFilesInF2FYear(yearFolderId) {
    try {
      const response = await this.drive.files.list({
        q: `'${yearFolderId}' in parents and trashed=false and name contains '(Google Sheets)'`,
        fields: "files(id, name, mimeType, modifiedTime)",
        orderBy: "name",
      })
      return response.data.files.filter((file) => file.mimeType === "application/vnd.google-apps.spreadsheet")
    } catch (error) {
      console.error("Erro ao listar arquivos de pesquisa F2F:", error)
      throw error
    }
  }

  _chunkArray(array, chunkSize) {
    const chunks = []
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize))
    }
    return chunks
  }

  _extractRodada(fileName) {
    const match = fileName.match(/RODADA\s+(\d+)/i)
    return match ? Number.parseInt(match[1]) : null
  }

  _extractRodadaFromDictName(fileName) {
    const match = fileName.match(/Rodada\s+(\d+)/i)
    return match ? Number.parseInt(match[1], 10) : null
  }

  async listAllDictionaryFiles() {
    try {
      const dictionaryFolders = {
        2023: "1TQcSsIm1ZzCco2YcdgHoNYhBize2DyfZ",
        2024: "1C7fXBwEi_MW8Zz9MyegeWmm6mm4cpnNX",
        2025: "1-WZoIvaRPFXyvdNkjTg92OTz0PGmF-uD",
      }
      const allDictionaries = {} // { rodadaNumber: fileId, ... }

      console.log("Listando arquivos de dicionário do Google Drive...")
      for (const year in dictionaryFolders) {
        const folderId = dictionaryFolders[year]
        const response = await this.drive.files.list({
          q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and name contains 'Dicionário'`,
          fields: "files(id, name)",
        })

        for (const file of response.data.files) {
          const rodada = this._extractRodadaFromDictName(file.name)
          if (rodada) {
            if (allDictionaries[rodada]) {
              console.warn(`⚠️  Dicionário duplicado para Rodada ${rodada}. Usando o último encontrado: ${file.name}`)
            }
            allDictionaries[rodada] = file.id
          } else {
            console.warn(`⚠️  Não foi possível extrair número da rodada do arquivo: ${file.name}`)
          }
        }
      }
      console.log(`Encontrados ${Object.keys(allDictionaries).length} arquivos de dicionário.`)
      return allDictionaries
    } catch (error) {
      console.error("Erro ao listar arquivos de dicionário:", error)
      throw error
    }
  }

  async listAllSurveyFiles() {
    try {
      if (this.cache.allSurveyFiles && this._isCacheValid()) {
        return this.cache.allSurveyFiles
      }

      const yearFolders = await this.listYearFolders()
      const result = { totalYears: yearFolders.length, years: {}, summary: [] }

      const chunks = this._chunkArray(yearFolders, this.MAX_CONCURRENT_FILES)
      for (const chunk of chunks) {
        const promises = chunk.map(async (yearFolder) => {
          const surveyFiles = await this.listSurveyFilesInYear(yearFolder.id)
          return {
            year: yearFolder.name,
            data: {
              folderId: yearFolder.id,
              folderName: yearFolder.name,
              totalFiles: surveyFiles.length,
              files: surveyFiles.map((file) => ({
                id: file.id,
                name: file.name,
                modifiedTime: file.modifiedTime,
                rodada: this._extractRodada(file.name),
              })),
            },
          }
        })
        const chunkResults = await Promise.all(promises)
        chunkResults.forEach(({ year, data }) => {
          result.years[year] = data
          result.summary.push({
            year: year,
            totalFiles: data.totalFiles,
            lastModified:
              data.files.length > 0 ? Math.max(...data.files.map((f) => new Date(f.modifiedTime).getTime())) : null,
          })
        })
      }
      result.summary.sort((a, b) => b.year.localeCompare(a.year))
      this.cache.allSurveyFiles = result
      return result
    } catch (error) {
      console.error("Erro ao listar todos os arquivos de pesquisa:", error)
      throw error
    }
  }

  // NOVO: Método para listar todos os arquivos de pesquisa F2F
  async listAllF2FSurveyFiles() {
    try {
      if (this.cache.allF2FSurveyFiles && this._isCacheValid()) {
        return this.cache.allF2FSurveyFiles
      }

      const result = { totalYears: Object.keys(this.f2fYearFolderIds).length, years: {}, summary: [] }

      const yearEntries = Object.entries(this.f2fYearFolderIds)

      for (const [year, folderId] of yearEntries) {
        const surveyFiles = await this.listSurveyFilesInF2FYear(folderId)
        const data = {
          folderId: folderId,
          folderName: year,
          totalFiles: surveyFiles.length,
          files: surveyFiles.map((file) => ({
            id: file.id,
            name: file.name,
            modifiedTime: file.modifiedTime,
            rodada: this._extractRodada(file.name), // Tenta extrair rodada se houver
          })),
        }
        result.years[year] = data
        result.summary.push({
          year: year,
          totalFiles: data.totalFiles,
          lastModified:
            data.files.length > 0 ? Math.max(...data.files.map((f) => new Date(f.modifiedTime).getTime())) : null,
        })
      }

      result.summary.sort((a, b) => b.year.localeCompare(a.year))
      this.cache.allF2FSurveyFiles = result
      this.cache.lastUpdate = Date.now()
      return result
    } catch (error) {
      console.error("Erro ao listar todos os arquivos de pesquisa F2F:", error)
      throw error
    }
  }

  async readGoogleSheetsFile(fileId) {
    try {
      // Verificar cache primeiro
      if (this.cache.fileData.has(fileId)) {
        console.log(`📋 Usando cache para arquivo ${fileId}`)
        return this.cache.fileData.get(fileId)
      }

      console.log(`📖 Lendo arquivo ${fileId}...`)

      // Obter informações do arquivo
      const fileInfo = await this.drive.files.get({
        fileId: fileId,
        fields: "name, modifiedTime",
      })

      // Primeiro, obter apenas a lista de abas (sem dados)
      const spreadsheetMeta = await this.sheets.spreadsheets.get({
        spreadsheetId: fileId,
        fields: "sheets.properties.title",
      })

      const result = {
        fileId: fileId,
        fileName: fileInfo.data.name,
        modifiedTime: fileInfo.data.modifiedTime,
        sheets: {},
        sheetNames: [],
      }

      // Obter nomes das abas
      const sheetNames = spreadsheetMeta.data.sheets.map((sheet) => sheet.properties.title)
      result.sheetNames = sheetNames

      console.log(`  📊 Arquivo possui ${sheetNames.length} abas`)

      // Ler cada aba individualmente para evitar erro de string muito longa
      for (const sheetName of sheetNames) {
        try {
          console.log(`    -> Lendo aba: ${sheetName}`)

          // Usar a API values.get que é mais eficiente para dados grandes
          const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: fileId,
            range: sheetName,
            valueRenderOption: "FORMATTED_VALUE",
          })

          const rows = response.data.values || []

          // Filtrar linhas vazias
          result.sheets[sheetName] =
            rows.length > 0 ? rows.filter((row) => row.some((cell) => cell !== null && cell !== "")) : []

          console.log(`    ✅ Aba '${sheetName}': ${result.sheets[sheetName].length} linhas`)
        } catch (sheetError) {
          console.error(`❌ Erro ao ler a aba '${sheetName}' do arquivo ${fileId}. Pulando.`, sheetError.message)
          result.sheets[sheetName] = []
        }
      }

      // Armazenar no cache
      this.cache.fileData.set(fileId, result)

      console.log(`✅ Arquivo ${fileId} lido com sucesso`)
      return result
    } catch (error) {
      console.error("Erro ao ler arquivo Google Sheets:", error)
      throw error
    }
  }
}

module.exports = GoogleDriveService
