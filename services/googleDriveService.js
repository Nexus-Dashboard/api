// services/googleDriveService.js
const googleAuth = require("../config/googleAuth")
const XLSX = require("xlsx")

class GoogleDriveService {
  constructor() {
    this.drive = null
    this.sheets = null
    this.rootFolderId = "1PA_g6SLCYe_VIn5L7sT7a2CqOOu3v01b"

    // Cache para melhorar performance
    this.cache = {
      yearFolders: null,
      allSurveyFiles: null,
      fileData: new Map(),
      questionData: new Map(),
      lastUpdate: null,
    }

    // Configurações de performance
    this.CACHE_DURATION = 5 * 60 * 1000 // 5 minutos
    this.MAX_CONCURRENT_FILES = 5 // Processar 5 arquivos em paralelo
    this.MAX_CONCURRENT_SHEETS = 3 // Processar 3 sheets em paralelo
  }

  async initialize() {
    await googleAuth.initialize()
    this.drive = googleAuth.getDrive()
    this.sheets = googleAuth.getSheets()
  }

  // Verificar se cache é válido
  _isCacheValid() {
    return this.cache.lastUpdate && Date.now() - this.cache.lastUpdate < this.CACHE_DURATION
  }

  // Limpar cache
  clearCache() {
    this.cache = {
      yearFolders: null,
      allSurveyFiles: null,
      fileData: new Map(),
      questionData: new Map(),
      lastUpdate: null,
    }
  }

  // Listar todas as pastas de anos (com cache)
  async listYearFolders() {
    try {
      if (this.cache.yearFolders && this._isCacheValid()) {
        console.log("📋 Usando cache para pastas de anos")
        return this.cache.yearFolders
      }

      console.log("🔍 Buscando pastas de anos...")
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

      console.log(`✅ Encontradas ${yearFolders.length} pastas de anos`)
      return yearFolders
    } catch (error) {
      console.error("Erro ao listar pastas de anos:", error)
      throw error
    }
  }

  // Listar arquivos de pesquisa em uma pasta específica (otimizado)
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

  // Listar todos os arquivos de pesquisa (com cache e processamento paralelo)
  async listAllSurveyFiles() {
    try {
      if (this.cache.allSurveyFiles && this._isCacheValid()) {
        console.log("📋 Usando cache para lista de pesquisas")
        return this.cache.allSurveyFiles
      }

      console.log("🔍 Buscando todos os arquivos de pesquisa...")
      const yearFolders = await this.listYearFolders()

      const result = {
        totalYears: yearFolders.length,
        years: {},
        summary: [],
      }

      // Processar pastas em paralelo (limitado)
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
      console.log(`✅ Cache atualizado com ${result.totalYears} anos`)

      return result
    } catch (error) {
      console.error("Erro ao listar todos os arquivos de pesquisa:", error)
      throw error
    }
  }

  // Dividir array em chunks para processamento paralelo
  _chunkArray(array, chunkSize) {
    const chunks = []
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize))
    }
    return chunks
  }

  // Extrair número da rodada do nome do arquivo
  _extractRodada(fileName) {
    const match = fileName.match(/RODADA\s+(\d+)/i)
    return match ? Number.parseInt(match[1]) : null
  }

  // Ler dados de um arquivo Google Sheets (com cache)
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

      // Ler dados usando Google Sheets API (mais eficiente)
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: fileId,
        includeGridData: true,
        ranges: [], // Buscar todas as sheets
      })

      const result = {
        fileId: fileId,
        fileName: fileInfo.data.name,
        modifiedTime: fileInfo.data.modifiedTime,
        sheets: {},
        sheetNames: [],
      }

      // Processar sheets em paralelo
      const sheetPromises = response.data.sheets.map(async (sheet) => {
        const sheetName = sheet.properties.title
        result.sheetNames.push(sheetName)

        if (sheet.data && sheet.data[0] && sheet.data[0].rowData) {
          const rows = sheet.data[0].rowData.map((row) => {
            if (row.values) {
              return row.values.map((cell) => {
                if (cell.formattedValue !== undefined) {
                  return cell.formattedValue
                } else if (cell.effectiveValue) {
                  return (
                    cell.effectiveValue.stringValue ||
                    cell.effectiveValue.numberValue ||
                    cell.effectiveValue.boolValue ||
                    ""
                  )
                }
                return ""
              })
            }
            return []
          })

          result.sheets[sheetName] = rows.filter((row) => row.some((cell) => cell !== ""))
        }
      })

      await Promise.all(sheetPromises)

      // Armazenar no cache
      this.cache.fileData.set(fileId, result)

      return result
    } catch (error) {
      console.error("Erro ao ler arquivo Google Sheets:", error)
      throw error
    }
  }

  // Buscar dados históricos de uma pergunta (OTIMIZADO)
  async getQuestionHistoricalData(questionCode) {
    try {
      const cacheKey = `question_${questionCode}`

      // Verificar cache
      if (this.cache.questionData.has(cacheKey) && this._isCacheValid()) {
        console.log(`📋 Usando cache para pergunta ${questionCode}`)
        return this.cache.questionData.get(cacheKey)
      }

      console.log(`🔍 Buscando dados históricos para pergunta: ${questionCode}`)
      const startTime = Date.now()

      const allFiles = await this.listAllSurveyFiles()
      const results = {
        questionCode: questionCode,
        totalYears: 0,
        totalFiles: 0,
        totalResponses: 0,
        years: {},
        summary: [],
      }

      // Coletar todos os arquivos para processamento
      const filesToProcess = []
      for (const [year, yearData] of Object.entries(allFiles.years)) {
        if (yearData.files.length === 0) continue

        yearData.files.forEach((file) => {
          filesToProcess.push({ ...file, year })
        })
      }

      console.log(`📊 Processando ${filesToProcess.length} arquivos...`)

      // Processar arquivos em chunks paralelos
      const fileChunks = this._chunkArray(filesToProcess, this.MAX_CONCURRENT_FILES)

      for (let chunkIndex = 0; chunkIndex < fileChunks.length; chunkIndex++) {
        const chunk = fileChunks[chunkIndex]
        console.log(`⚡ Processando chunk ${chunkIndex + 1}/${fileChunks.length} (${chunk.length} arquivos)`)

        const chunkPromises = chunk.map(async (file) => {
          try {
            const fileData = await this.readGoogleSheetsFile(file.id)
            const fileResults = []

            // Processar sheets do arquivo
            for (const [sheetName, sheetData] of Object.entries(fileData.sheets)) {
              if (sheetData.length > 1) {
                const headers = sheetData[0]
                const questionIndex = headers.findIndex(
                  (header) => header && header.toString().toUpperCase() === questionCode.toUpperCase(),
                )

                if (questionIndex !== -1) {
                  const responses = sheetData
                    .slice(1)
                    .map((row, index) => ({
                      responseId: index + 1,
                      entrevistadoId: row[0] || `resp_${index + 1}`,
                      questionValue: row[questionIndex],
                      uf: row[headers.findIndex((h) => h && h.toString().toUpperCase() === "UF")] || null,
                      regiao: row[headers.findIndex((h) => h && h.toString().toUpperCase() === "REGIAO")] || null,
                      municipio: row[headers.findIndex((h) => h && h.toString().toUpperCase() === "MUNICIPIO")] || null,
                      data: row[headers.findIndex((h) => h && h.toString().toUpperCase() === "DATA")] || null,
                    }))
                    .filter((item) => item.questionValue != null && item.questionValue !== "")

                  if (responses.length > 0) {
                    fileResults.push({
                      year: file.year,
                      fileId: file.id,
                      fileName: file.name,
                      sheetName: sheetName,
                      rodada: file.rodada || 1,
                      responses: responses,
                    })
                  }
                }
              }
            }

            return fileResults
          } catch (fileError) {
            console.error(`❌ Erro ao processar arquivo ${file.name}:`, fileError.message)
            return []
          }
        })

        const chunkResults = await Promise.all(chunkPromises)

        // Organizar resultados por ano
        chunkResults.flat().forEach((fileResult) => {
          if (!fileResult.year) return

          if (!results.years[fileResult.year]) {
            results.years[fileResult.year] = {
              year: fileResult.year,
              totalFiles: 0,
              totalResponses: 0,
              rodadas: {},
            }
            results.totalYears++
          }

          const rodada = fileResult.rodada
          if (!results.years[fileResult.year].rodadas[rodada]) {
            results.years[fileResult.year].rodadas[rodada] = {
              rodada: rodada,
              files: [],
              totalResponses: 0,
              responses: [],
            }
          }

          results.years[fileResult.year].rodadas[rodada].files.push({
            fileId: fileResult.fileId,
            fileName: fileResult.fileName,
            sheetName: fileResult.sheetName,
            responsesCount: fileResult.responses.length,
          })

          results.years[fileResult.year].rodadas[rodada].responses.push(...fileResult.responses)
          results.years[fileResult.year].rodadas[rodada].totalResponses += fileResult.responses.length
          results.years[fileResult.year].totalResponses += fileResult.responses.length
          results.years[fileResult.year].totalFiles++
          results.totalFiles++
          results.totalResponses += fileResult.responses.length
        })
      }

      // Criar resumo
      Object.keys(results.years).forEach((year) => {
        if (results.years[year].totalResponses > 0) {
          results.summary.push({
            year: year,
            totalFiles: results.years[year].totalFiles,
            totalResponses: results.years[year].totalResponses,
            rodadas: Object.keys(results.years[year].rodadas)
              .map((r) => Number.parseInt(r))
              .sort((a, b) => a - b),
          })
        }
      })

      results.summary.sort((a, b) => b.year.localeCompare(a.year))

      // Armazenar no cache
      this.cache.questionData.set(cacheKey, results)

      const endTime = Date.now()
      console.log(`✅ Pergunta ${questionCode} processada em ${(endTime - startTime) / 1000}s`)
      console.log(`📊 Total: ${results.totalResponses} respostas de ${results.totalFiles} arquivos`)

      return results
    } catch (error) {
      console.error("Erro ao buscar dados históricos da pergunta:", error)
      throw error
    }
  }

  // Buscar dados agregados (otimizado)
  async getQuestionAggregatedData(questionCode) {
    try {
      console.log(`📊 Agregando dados para pergunta: ${questionCode}`)
      const historicalData = await this.getQuestionHistoricalData(questionCode)

      const aggregated = {
        questionCode: questionCode,
        totalResponses: historicalData.totalResponses,
        totalYears: historicalData.totalYears,
        totalFiles: historicalData.totalFiles,
        responseDistribution: {},
        byYear: {},
        byRegion: {},
        byUF: {},
        timeline: [],
      }

      // Processar dados de forma mais eficiente
      for (const [year, yearData] of Object.entries(historicalData.years)) {
        if (yearData.totalResponses === 0) continue

        aggregated.byYear[year] = {
          totalResponses: yearData.totalResponses,
          responseDistribution: {},
          byRegion: {},
          byUF: {},
        }

        for (const [rodada, rodadaData] of Object.entries(yearData.rodadas)) {
          // Processar respostas em lote
          const responseStats = this._processResponsesBatch(rodadaData.responses)

          // Merge com dados gerais
          this._mergeStats(aggregated.responseDistribution, responseStats.responseDistribution)
          this._mergeStats(aggregated.byYear[year].responseDistribution, responseStats.responseDistribution)
          this._mergeNestedStats(aggregated.byRegion, responseStats.byRegion)
          this._mergeNestedStats(aggregated.byUF, responseStats.byUF)
          this._mergeNestedStats(aggregated.byYear[year].byRegion, responseStats.byRegion)
          this._mergeNestedStats(aggregated.byYear[year].byUF, responseStats.byUF)

          // Timeline
          aggregated.timeline.push({
            year: year,
            rodada: Number.parseInt(rodada),
            totalResponses: rodadaData.totalResponses,
            date: `${year}-R${rodada}`,
            responseDistribution: { ...responseStats.responseDistribution },
          })
        }
      }

      aggregated.timeline.sort((a, b) => {
        if (a.year !== b.year) return a.year.localeCompare(b.year)
        return a.rodada - b.rodada
      })

      return aggregated
    } catch (error) {
      console.error("Erro ao agregar dados da pergunta:", error)
      throw error
    }
  }

  // Processar respostas em lote (mais eficiente)
  _processResponsesBatch(responses) {
    const stats = {
      responseDistribution: {},
      byRegion: {},
      byUF: {},
    }

    responses.forEach((response) => {
      const value = response.questionValue

      // Distribuição de respostas
      stats.responseDistribution[value] = (stats.responseDistribution[value] || 0) + 1

      // Por região
      if (response.regiao) {
        if (!stats.byRegion[response.regiao]) stats.byRegion[response.regiao] = {}
        stats.byRegion[response.regiao][value] = (stats.byRegion[response.regiao][value] || 0) + 1
      }

      // Por UF
      if (response.uf) {
        if (!stats.byUF[response.uf]) stats.byUF[response.uf] = {}
        stats.byUF[response.uf][value] = (stats.byUF[response.uf][value] || 0) + 1
      }
    })

    return stats
  }

  // Merge de estatísticas simples
  _mergeStats(target, source) {
    for (const [key, value] of Object.entries(source)) {
      target[key] = (target[key] || 0) + value
    }
  }

  // Merge de estatísticas aninhadas
  _mergeNestedStats(target, source) {
    for (const [outerKey, innerObj] of Object.entries(source)) {
      if (!target[outerKey]) target[outerKey] = {}
      for (const [innerKey, value] of Object.entries(innerObj)) {
        target[outerKey][innerKey] = (target[outerKey][innerKey] || 0) + value
      }
    }
  }
}

module.exports = GoogleDriveService
