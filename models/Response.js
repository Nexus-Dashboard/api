// models/Response.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

// cada resposta vira um par key/value
const AnswerSchema = new Schema({
  key:   { type: String, required: true },
  value: { type: Schema.Types.Mixed }
}, { _id: false });

const ResponseSchema = new Schema({
  surveyId:       { type: Schema.Types.ObjectId, ref: 'Survey', required: true, index: true },
  entrevistadoId: { type: String,                 required: true, index: true },
  answers:        { type: [AnswerSchema],         required: true },
  createdAt:      { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('Response', ResponseSchema);