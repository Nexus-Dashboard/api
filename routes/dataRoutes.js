// routes/dataRoutes.js
const express = require("express")
const mongoose = require("mongoose")
const router = express.Router()
const Survey = require("../models/Survey")
const Response = require("../models/Response")
const connectDB = require("../config/db")

// PUT /api/data
// Espera { surveyInfo: { name, month?, year?, variables? }, data: [ {...}, ... ] }
router.put("/data", async (req, res) => {
  try {
    // Garante conexão com o banco
    await connectDB()

    const { surveyInfo, data } = req.body
    const { fileHash } = surveyInfo
    if (!surveyInfo?.name) {
      return res.status(400).json({ error: "surveyInfo.name é obrigatório" })
    }
    if (!Array.isArray(data)) {
      return res.status(400).json({ error: "data deve ser um array" })
    }

    // 0) se survey já existir e já tiver esse hash, rejeita
    const existingSurvey = await Survey.findOne({ name: surveyInfo.name })
    if (existingSurvey && fileHash && existingSurvey.fileHashes.includes(fileHash)) {
      return res.status(409).json({
        error: "Este arquivo já foi processado anteriormente.",
        fileHash,
      })
    }

    // Filtra variáveis sem chave (evita duplicatas null)
    const variables = Array.isArray(surveyInfo.variables)
      ? surveyInfo.variables.filter((v) => v.key != null && String(v.key).trim() !== "")
      : []

    // Upsert no Survey (cadastra ou atualiza pesquisa)
    const survey = await Survey.findOneAndUpdate(
      { name: surveyInfo.name },
      {
        $set: {
          month: surveyInfo.month,
          year: surveyInfo.year,
          variables: variables,
        },
      },
      { upsert: true, new: true },
    )

    // Prepara respostas para inserção
    const responses = data.map((item) => {
      // extrai entrevistadoId de item.idEntrevista (que vem como { label, value })
      const raw = item.idEntrevista
      const entrevistadoId = raw && raw.value != null ? String(raw.value) : String(raw)

      // converte cada par [chave → {label,value}] em { key,value }
      const answers = Object.entries(item).map(([key, cell]) => ({
        key,
        value: cell.value,
      }))

      return {
        surveyId: survey._id,
        entrevistadoId, // agora sempre string definida
        answers, // array de AnswerSchema
        createdAt: new Date(),
      }
    })
    const inserted = await Response.insertMany(responses)

    // 4) após inserção bem‑sucedida, adiciona o hash ao survey
    if (fileHash) {
      await Survey.updateOne({ _id: survey._id }, { $addToSet: { fileHashes: fileHash } })
    }
    return res.status(201).json({ insertedCount: inserted.length })
  } catch (err) {
    console.error("Erro ao salvar dados.", err)
    return res.status(500).json({ error: "Erro ao salvar dados." })
  }
})

// GET /api/surveys
// Retorna lista de pesquisas cadastradas
router.get("/surveys", async (req, res) => {
  try {
    // Garante conexão com o banco
    await connectDB()

    const surveys = await Survey.find()
    res.json(surveys)
  } catch (err) {
    console.error("Erro ao buscar surveys:", err)
    res.status(500).json({ error: "Erro ao buscar surveys." })
  }
})

// GET /api/responses/:surveyId
// Retorna todas as respostas de um survey específico
router.get("/responses/:surveyId", async (req, res) => {
  try {
    // Garante conexão com o banco
    await connectDB()

    const { surveyId } = req.params
    const responses = await Response.find({ surveyId })
    res.json(responses)
  } catch (err) {
    console.error("Erro ao buscar respostas:", err)
    res.status(500).json({ error: "Erro ao buscar respostas." })
  }
})

// GET /api/responsesFlat/:surveyId
router.get("/responsesFlat/:surveyId", async (req, res) => {
  try {
    // Garante conexão com o banco
    await connectDB()

    const { surveyId } = req.params
    const pivoted = await Response.aggregate([
      { $match: { surveyId: new mongoose.Types.ObjectId(surveyId) } },
      {
        $project: {
          entrevistadoId: 1,
          createdAt: 1,
          answersObj: {
            $arrayToObject: {
              $map: {
                input: "$answers",
                as: "a",
                in: ["$$a.key", "$$a.value"],
              },
            },
          },
        },
      },
      {
        $replaceRoot: {
          newRoot: { $mergeObjects: ["$$ROOT", "$answersObj"] },
        },
      },
      { $project: { answers: 0, answersObj: 0, __v: 0 } },
    ])
    res.json(pivoted)
  } catch (err) {
    console.error("Erro ao buscar respostas flatten", err)
    res.status(500).json({ error: "Erro ao buscar respostas flatten" })
  }
})

module.exports = router
