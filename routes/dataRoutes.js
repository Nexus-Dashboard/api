// routes/dataRoutes.js
const express = require('express');
const router = express.Router();
const Data = require('../models/Data');

// PUT /api/data
// Recebe um JSON com { data: [ ... ] } e salva cada item como documento
router.put('/data', async (req, res) => {
  try {
    const items = req.body.data;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Campo "data" deve ser um array.' });
    }
    // Inserção em massa
    const inserted = await Data.insertMany(items);
    res.status(201).json({ insertedCount: inserted.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar dados.' });
  }
});

// GET /api/data
// Retorna todos os documentos
router.get('/data', async (req, res) => {
  try {
    const all = await Data.find();
    res.json(all);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar dados.' });
  }
});

// GET /api/data/:idEntrevista
// Retorna apenas o documento com o idEntrevista especificado
router.get('/data/:idEntrevista', async (req, res) => {
  try {
    const doc = await Data.findOne({ idEntrevista: Number(req.params.idEntrevista) });
    if (!doc) return res.status(404).json({ error: 'Não encontrado.' });
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar dado.' });
  }
});

module.exports = router;