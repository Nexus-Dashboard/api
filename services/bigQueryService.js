// services/bigQueryService.js
const { BigQuery } = require('@google-cloud/bigquery');

class BigQueryService {
  constructor() {
    this.bigquery = new BigQuery({
      projectId: process.env.GCP_PROJECT_ID,
      credentials: {
        client_email: process.env.SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
      }
    });
    
    this.datasetId = process.env.BQ_DATASET_ID || 'survey_data';
    this.projectId = process.env.GCP_PROJECT_ID;
    
    // Cache simples em memória
    this.cache = new Map();
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutos
  }

  /**
   * Cache helper
   */
  getCached(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }
    return null;
  }

  setCached(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Busca respostas de uma pergunta específica com agregações
   * Equivalente ao seu pipeline MongoDB atual
   */
  async getQuestionResponses(questionCode, theme, surveyNumbers) {
    const cacheKey = `question_${questionCode}_${theme}_${surveyNumbers.join(',')}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const query = `
      WITH question_responses AS (
        SELECT 
          year,
          rodada,
          CONCAT(CAST(year AS STRING), '-R', CAST(rodada AS STRING)) as period,
          answer_value as mainAnswer,
          COALESCE(weight, 1.0) as weight,
          uf,
          regiao,
          pf1, pf2_faixas, pf3, pf4, pf5, pf6, pf7, pf8, pf9, pf10
        FROM \`${this.projectId}.${this.datasetId}.responses\`
        WHERE 
          question_code = @questionCode
          AND rodada IN UNNEST(@surveyNumbers)
          AND answer_value IS NOT NULL
          AND answer_value != ''
      )
      SELECT
        year,
        rodada,
        period,
        mainAnswer as response,
        COUNT(*) as count,
        ROUND(SUM(weight), 2) as weightedCount,
        
        -- Demographics UF
        ARRAY_AGG(
          STRUCT(
            uf as response,
            COUNT(*) OVER (PARTITION BY mainAnswer, uf) as count,
            ROUND(SUM(weight) OVER (PARTITION BY mainAnswer, uf), 2) as weightedCount
          ) IGNORE NULLS
        ) as demographics_uf,
        
        -- Demographics Região
        ARRAY_AGG(
          STRUCT(
            regiao as response,
            COUNT(*) OVER (PARTITION BY mainAnswer, regiao) as count,
            ROUND(SUM(weight) OVER (PARTITION BY mainAnswer, regiao), 2) as weightedCount
          ) IGNORE NULLS
        ) as demographics_regiao,
        
        -- Demographics Faixa Etária
        ARRAY_AGG(
          STRUCT(
            pf2_faixas as response,
            COUNT(*) OVER (PARTITION BY mainAnswer, pf2_faixas) as count,
            ROUND(SUM(weight) OVER (PARTITION BY mainAnswer, pf2_faixas), 2) as weightedCount
          ) IGNORE NULLS
        ) as demographics_age
        
      FROM question_responses
      WHERE mainAnswer IS NOT NULL
      GROUP BY year, rodada, period, mainAnswer, uf, regiao, pf2_faixas
      ORDER BY year DESC, rodada DESC, weightedCount DESC
    `;

    const options = {
      query: query,
      params: {
        questionCode: questionCode.toUpperCase(),
        surveyNumbers: surveyNumbers.map(s => parseInt(s))
      },
      location: process.env.BQ_LOCATION || 'southamerica-east1'
    };

    try {
      console.log(`🔍 BigQuery: Buscando ${questionCode}`);
      const [rows] = await this.bigquery.query(options);
      
      const result = this.transformBigQueryResults(rows);
      this.setCached(cacheKey, result);
      
      return result;
    } catch (error) {
      console.error('❌ Erro na query BigQuery:', error);
      throw error;
    }
  }

  /**
   * Transforma resultados do BigQuery para o formato da API atual
   */
  transformBigQueryResults(rows) {
    const groupedByPeriod = new Map();

    for (const row of rows) {
      const periodKey = row.period;
      
      if (!groupedByPeriod.has(periodKey)) {
        groupedByPeriod.set(periodKey, {
          year: row.year,
          rodada: row.rodada,
          period: row.period,
          totalResponses: 0,
          totalWeightedResponses: 0,
          distribution: []
        });
      }

      const periodData = groupedByPeriod.get(periodKey);
      periodData.totalResponses += row.count;
      periodData.totalWeightedResponses += row.weightedCount;

      // Processar demographics
      const demographics = {};
      
      if (row.demographics_uf) {
        demographics.UF = this.deduplicateDemographics(row.demographics_uf);
      }
      if (row.demographics_regiao) {
        demographics.Regiao = this.deduplicateDemographics(row.demographics_regiao);
      }
      if (row.demographics_age) {
        demographics.PF2_faixas = this.deduplicateDemographics(row.demographics_age);
      }

      periodData.distribution.push({
        response: row.response,
        count: row.count,
        weightedCount: row.weightedCount,
        demographics: demographics
      });
    }

    return Array.from(groupedByPeriod.values());
  }

  /**
   * Remove duplicatas de demographics e ordena
   */
  deduplicateDemographics(demoArray) {
    const deduped = new Map();
    
    for (const item of demoArray) {
      if (!item.response) continue;
      
      if (!deduped.has(item.response)) {
        deduped.set(item.response, {
          response: item.response,
          count: 0,
          weightedCount: 0
        });
      }
      
      const existing = deduped.get(item.response);
      existing.count = Math.max(existing.count, item.count);
      existing.weightedCount = Math.max(existing.weightedCount, item.weightedCount);
    }
    
    return Array.from(deduped.values())
      .sort((a, b) => b.weightedCount - a.weightedCount);
  }

  /**
   * Busca perguntas agrupadas (múltiplas variáveis)
   */
  async getGroupedResponses(theme, questionText, variables, baseCode) {
    const cacheKey = `grouped_${theme}_${questionText ? questionText.substring(0,50) : variables.join(',')}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    // Buscar variáveis relacionadas no question_index
    let questionCodes = variables;
    let surveyNumbers = [];

    if (!variables || variables.length === 0) {
      // Buscar por questionText
      const indexQuery = `
        SELECT DISTINCT question_code, survey_number
        FROM \`${this.projectId}.${this.datasetId}.question_index\`
        WHERE theme = @theme
          AND question_text = @questionText
      `;

      const [indexResults] = await this.bigquery.query({
        query: indexQuery,
        params: { theme, questionText }
      });

      questionCodes = [...new Set(indexResults.map(r => r.question_code))];
      surveyNumbers = [...new Set(indexResults.map(r => parseInt(r.survey_number)))];
    }

    // Query principal
    const query = `
      SELECT
        year,
        rodada,
        CONCAT(CAST(year AS STRING), '-R', CAST(rodada AS STRING)) as period,
        question_code,
        answer_value as response,
        COUNT(*) as count,
        ROUND(SUM(COALESCE(weight, 1.0)), 2) as weightedCount
      FROM \`${this.projectId}.${this.datasetId}.responses\`
      WHERE question_code IN UNNEST(@questionCodes)
        ${surveyNumbers.length > 0 ? 'AND rodada IN UNNEST(@surveyNumbers)' : ''}
      GROUP BY year, rodada, period, question_code, response
      ORDER BY year DESC, rodada DESC, weightedCount DESC
    `;

    const params = { questionCodes };
    if (surveyNumbers.length > 0) {
      params.surveyNumbers = surveyNumbers;
    }

    const [rows] = await this.bigquery.query({ query, params });
    
    const result = this.transformGroupedResults(rows);
    this.setCached(cacheKey, result);
    
    return result;
  }

  /**
   * Transforma resultados agrupados
   */
  transformGroupedResults(rows) {
    const groupedByPeriod = new Map();

    for (const row of rows) {
      const periodKey = row.period;
      
      if (!groupedByPeriod.has(periodKey)) {
        groupedByPeriod.set(periodKey, {
          year: row.year,
          rodada: row.rodada,
          period: row.period,
          totalResponses: 0,
          totalWeightedResponses: 0,
          distribution: {}
        });
      }

      const periodData = groupedByPeriod.get(periodKey);
      
      if (!periodData.distribution[row.question_code]) {
        periodData.distribution[row.question_code] = [];
      }

      periodData.distribution[row.question_code].push({
        response: row.response,
        count: row.count,
        weightedCount: row.weightedCount
      });

      periodData.totalResponses += row.count;
      periodData.totalWeightedResponses += row.weightedCount;
    }

    return Array.from(groupedByPeriod.values());
  }

  /**
   * Busca temas disponíveis
   */
  async getThemes() {
    const cacheKey = 'themes_all';
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const query = `
      SELECT 
        theme,
        COUNT(*) as questionCount,
        ARRAY_AGG(DISTINCT survey_number ORDER BY CAST(survey_number AS INT64)) as rounds
      FROM \`${this.projectId}.${this.datasetId}.question_index\`
      WHERE theme IS NOT NULL AND theme != ''
      GROUP BY theme
      ORDER BY theme
    `;

    const [rows] = await this.bigquery.query({ query });
    
    this.setCached(cacheKey, rows);
    return rows;
  }

  /**
   * Busca perguntas de um tema
   */
  async getThemeQuestions(theme) {
    const cacheKey = `theme_${theme}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const query = `
      SELECT DISTINCT
        question_code as variable,
        question_text as questionText,
        label,
        survey_number as surveyNumber,
        survey_name as surveyName
      FROM \`${this.projectId}.${this.datasetId}.question_index\`
      WHERE theme = @theme
      ORDER BY variable, surveyNumber
    `;

    const [rows] = await this.bigquery.query({
      query,
      params: { theme }
    });

    this.setCached(cacheKey, rows);
    return rows;
  }

  /**
   * Busca com paginação
   */
  async getAllQuestionsWithPagination(page = 1, limit = 50, filters = {}) {
    const offset = (page - 1) * limit;
    
    let whereClause = 'WHERE 1=1';
    const params = { limit, offset };

    if (filters.search) {
      whereClause += ` AND (
        question_code LIKE @search 
        OR question_text LIKE @search
        OR label LIKE @search
      )`;
      params.search = `%${filters.search}%`;
    }

    if (filters.theme) {
      whereClause += ' AND theme = @theme';
      params.theme = filters.theme;
    }

    const query = `
      SELECT
        id,
        survey_number as surveyNumber,
        survey_name as surveyName,
        question_code as variable,
        question_text as questionText,
        label,
        theme as index,
        date
      FROM \`${this.projectId}.${this.datasetId}.question_index\`
      ${whereClause}
      ORDER BY CAST(survey_number AS INT64), question_code
      LIMIT @limit
      OFFSET @offset
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM \`${this.projectId}.${this.datasetId}.question_index\`
      ${whereClause}
    `;

    const [rows] = await this.bigquery.query({ query, params });
    const [countResult] = await this.bigquery.query({ 
      query: countQuery, 
      params: { search: params.search, theme: params.theme } 
    });

    const total = countResult[0].total;

    return {
      questions: rows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalQuestions: total,
        hasNext: offset + rows.length < total,
        hasPrev: page > 1,
        limit: limit
      }
    };
  }

  /**
   * Análise de séries temporais
   */
  async getQuestionTrend(questionCode, targetResponse) {
    const query = `
      WITH monthly_data AS (
        SELECT
          year,
          rodada,
          answer_value,
          COUNT(*) as count,
          SUM(COALESCE(weight, 1.0)) as weighted_count
        FROM \`${this.projectId}.${this.datasetId}.responses\`
        WHERE question_code = @questionCode
        GROUP BY year, rodada, answer_value
      ),
      total_by_period AS (
        SELECT
          year,
          rodada,
          SUM(count) as total_count,
          SUM(weighted_count) as total_weighted
        FROM monthly_data
        GROUP BY year, rodada
      )
      SELECT
        m.year,
        m.rodada,
        m.answer_value,
        m.count,
        m.weighted_count,
        t.total_count,
        t.total_weighted,
        ROUND((m.weighted_count / t.total_weighted) * 100, 2) as percentage
      FROM monthly_data m
      JOIN total_by_period t
        ON m.year = t.year AND m.rodada = t.rodada
      WHERE m.answer_value = @targetResponse
      ORDER BY m.year, m.rodada
    `;

    const [rows] = await this.bigquery.query({
      query,
      params: {
        questionCode: questionCode.toUpperCase(),
        targetResponse
      }
    });

    return rows.map(row => ({
      year: row.year,
      rodada: row.rodada,
      period: `${row.year}-R${row.rodada}`,
      targetCount: row.weighted_count,
      totalResponses: row.total_weighted,
      percentage: parseFloat(row.percentage)
    }));
  }

  /**
   * Busca variações de uma pergunta
   */
  async getQuestionVariations(questionCode, theme) {
    const query = `
      SELECT 
        id,
        question_code as variable,
        question_text as questionText,
        survey_number as surveyNumber,
        survey_name as surveyName,
        theme as index,
        date
      FROM \`${this.projectId}.${this.datasetId}.question_index\`
      WHERE question_code = @questionCode
        ${theme ? 'AND theme = @theme' : ''}
      ORDER BY CAST(survey_number AS INT64)
    `;

    const params = { questionCode: questionCode.toUpperCase() };
    if (theme) params.theme = theme;

    const [rows] = await this.bigquery.query({ query, params });
    return rows;
  }

  /**
   * Busca de texto livre em perguntas
   */
  async searchQuestions(searchTerm, limit = 20) {
    const query = `
      SELECT
        question_code as variable,
        question_text as questionText,
        label,
        theme as index,
        survey_number as surveyNumber,
        survey_name as surveyName
      FROM \`${this.projectId}.${this.datasetId}.question_index\`
      WHERE 
        question_code LIKE @search
        OR question_text LIKE @search
        OR label LIKE @search
      LIMIT @limit
    `;

    const [rows] = await this.bigquery.query({
      query,
      params: {
        search: `%${searchTerm}%`,
        limit
      }
    });

    return rows;
  }

  /**
   * Verifica saúde da conexão
   */
  async healthCheck() {
    try {
      const query = 'SELECT 1 as health';
      const [rows] = await this.bigquery.query({ query });
      return rows.length > 0;
    } catch (error) {
      console.error('❌ BigQuery health check failed:', error);
      return false;
    }
  }

  /**
   * Limpa cache
   */
  clearCache() {
    this.cache.clear();
    console.log('🧹 Cache do BigQuery limpo');
  }
}

module.exports = BigQueryService;