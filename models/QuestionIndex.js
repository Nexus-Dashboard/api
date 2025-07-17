const mongoose = require("mongoose")

const QuestionIndexSchema = new mongoose.Schema(
  {
    surveyNumber: String,
    surveyName: String,
    variable: { type: String, required: true },
    questionText: String,
    label: String,
    index: String,
    methodology: String,
    map: String,
    sample: String,
    date: String,
    possibleAnswers: [
      {
        value: String,
        label: String,
      },
    ],
  },
  { timestamps: true },
)

QuestionIndexSchema.index({ variable: 1 })
QuestionIndexSchema.index({ surveyNumber: 1, variable: 1 }, { unique: true })

module.exports = mongoose.model("QuestionIndex", QuestionIndexSchema)
