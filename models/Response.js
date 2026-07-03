const mongoose = require("mongoose")

const AnswerSchema = new mongoose.Schema(
  {
    k: { type: String, required: true }, // key -> k (economiza espaço)
    v: { type: mongoose.Schema.Types.Mixed }, // value -> v (economiza espaço)
  },
  { _id: false },
)

const ResponseSchema = new mongoose.Schema(
  {
    surveyId: { type: mongoose.Schema.Types.ObjectId, ref: "Survey", required: true },
    entrevistadoId: { type: String, required: true },
    answers: [AnswerSchema],
    rodada: Number,
    year: Number,
  },
  {
    timestamps: true, // Usa createdAt e updatedAt automáticos
    minimize: false, // Não remove campos vazios automaticamente
  },
)

ResponseSchema.index({ surveyId: 1 })
ResponseSchema.index({ "answers.k": 1 }) // Atualizado para o novo nome do campo
// Índice composto para as consultas por (variável, rodada) do getGroupedResponses.
// Sem ele, o filtro de rodada é aplicado só depois de buscar todos os documentos
// da variável em todas as rodadas. Build em produção: scripts/create-response-indexes.js
ResponseSchema.index({ "answers.k": 1, rodada: 1 })

module.exports = mongoose.model("Response", ResponseSchema)
