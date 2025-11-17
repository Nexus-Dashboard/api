// middleware/dataSource.js
const BigQueryService = require('../services/bigQueryService');

// Flag global para controlar qual source usar
// Pode ser configurado via env ou dinamicamente
const USE_BIGQUERY = process.env.USE_BIGQUERY === 'true';
const BIGQUERY_FALLBACK = process.env.BIGQUERY_FALLBACK === 'true'; // true = tenta MongoDB se BigQuery falhar

class DataSourceMiddleware {
  constructor() {
    this.bigQueryService = null;
    
    if (USE_BIGQUERY || BIGQUERY_FALLBACK) {
      try {
        this.bigQueryService = new BigQueryService();
        console.log('✅ BigQuery service inicializado');
      } catch (error) {
        console.error('❌ Erro ao inicializar BigQuery:', error.message);
        if (!BIGQUERY_FALLBACK) {
          throw error;
        }
      }
    }
  }

  /**
   * Middleware que adiciona informação de fonte de dados ao request
   */
  selectDataSource() {
    return (req, res, next) => {
      // Permite override via query parameter para testes
      const forceSource = req.query.source;
      
      if (forceSource === 'bigquery') {
        req.dataSource = 'bigquery';
        req.bigQueryService = this.bigQueryService;
      } else if (forceSource === 'mongodb') {
        req.dataSource = 'mongodb';
      } else {
        // Usar configuração padrão
        req.dataSource = USE_BIGQUERY ? 'bigquery' : 'mongodb';
        req.bigQueryService = this.bigQueryService;
      }

      // Flag de fallback
      req.useFallback = BIGQUERY_FALLBACK;

      next();
    };
  }

  /**
   * Wrapper para executar queries com fallback automático
   */
  async executeWithFallback(req, bigQueryFn, mongoFn) {
    if (req.dataSource === 'bigquery' && this.bigQueryService) {
      try {
        console.log('🔵 Usando BigQuery');
        const result = await bigQueryFn(this.bigQueryService);
        result._dataSource = 'bigquery';
        return result;
      } catch (error) {
        console.error('❌ Erro no BigQuery:', error.message);
        
        if (req.useFallback) {
          console.log('🔄 Tentando fallback para MongoDB...');
          try {
            const result = await mongoFn();
            result._dataSource = 'mongodb-fallback';
            result._fallbackReason = error.message;
            return result;
          } catch (mongoError) {
            console.error('❌ Erro no MongoDB também:', mongoError.message);
            throw mongoError;
          }
        } else {
          throw error;
        }
      }
    } else {
      console.log('🟢 Usando MongoDB');
      const result = await mongoFn();
      result._dataSource = 'mongodb';
      return result;
    }
  }

  /**
   * Health check de ambas as fontes
   */
  async healthCheck() {
    const health = {
      mongodb: false,
      bigquery: false,
      timestamp: new Date().toISOString()
    };

    // Check MongoDB
    try {
      const { getModel } = require('../config/dbManager');
      const Response = await getModel('Response', 'telephonic');
      const count = await Response.countDocuments().limit(1);
      health.mongodb = count !== undefined;
    } catch (error) {
      console.error('MongoDB health check failed:', error.message);
    }

    // Check BigQuery
    if (this.bigQueryService) {
      try {
        health.bigquery = await this.bigQueryService.healthCheck();
      } catch (error) {
        console.error('BigQuery health check failed:', error.message);
      }
    }

    return health;
  }
}

// Singleton
const dataSourceMiddleware = new DataSourceMiddleware();

module.exports = {
  dataSourceMiddleware,
  selectDataSource: () => dataSourceMiddleware.selectDataSource(),
  executeWithFallback: (req, bqFn, mongoFn) => 
    dataSourceMiddleware.executeWithFallback(req, bqFn, mongoFn),
};