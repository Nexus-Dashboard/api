// config/googleAuth.js
const { google } = require('googleapis');

class GoogleAuth {
  constructor() {
    this.auth = null;
    this.drive = null;
    this.sheets = null;
  }

  async initialize() {
    try {
      // Configuração usando Service Account
      this.auth = new google.auth.GoogleAuth({
        credentials: {
          type: process.env.TYPE,
          project_id: process.env.PROJECT_ID,
          private_key_id: process.env.PRIVATE_KEY_ID,
          private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
          client_email: process.env.SERVICE_ACCOUNT_EMAIL,
          client_id: process.env.CLIENT_ID,
          auth_uri: process.env.AUTH_URI,
          token_uri: process.env.TOKEN_URI,
          auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_X509_CERT_URL,
          client_x509_cert_url: process.env.CLIENT_X509_CERT_URL
        },
        scopes: [
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/spreadsheets'
        ]
      });

      const authClient = await this.auth.getClient();
      
      this.drive = google.drive({ version: 'v3', auth: authClient });
      this.sheets = google.sheets({ version: 'v4', auth: authClient });

      console.log('Google APIs inicializadas com sucesso!');
      return true;
    } catch (error) {
      console.error('Erro ao inicializar Google APIs:', error);
      throw error;
    }
  }

  getDrive() {
    if (!this.drive) {
      throw new Error('Google Drive não foi inicializado. Chame initialize() primeiro.');
    }
    return this.drive;
  }

  getSheets() {
    if (!this.sheets) {
      throw new Error('Google Sheets não foi inicializado. Chame initialize() primeiro.');
    }
    return this.sheets;
  }
}

module.exports = new GoogleAuth();