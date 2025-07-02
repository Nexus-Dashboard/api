const mongoose = require("mongoose")

const SurveySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true }, // rodada
    fileHashes: [{ type: String }], // To track processed files
  },
  { timestamps: true },
)

SurveySchema.index({ year: 1, month: 1 })

module.exports = mongoose.model("Survey", SurveySchema)
