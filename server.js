// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const dataRoutes = require('./routes/dataRoutes');

const app = express();

// Conexão com o banco
connectDB();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
// se usar form-urlencoded em algum lugar, faça o mesmo:
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rota básica para verificar status da API
app.get('/', (res) => {
  res.json({ success: true, message: 'API está ativa' });
});

// Rotas da API
app.use('/api', dataRoutes);

// Inicia o servidor
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
