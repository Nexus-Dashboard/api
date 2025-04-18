// models/Survey.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const VariableSchema = new Schema({
  key:   { type: String, required: true },
  label: { type: String, required: true },
  type:  { type: String, enum: ['single','multi','scale','text'], default: 'text' }
}, { _id: false });

const SurveySchema = new Schema({
  name:      { type: String, required: true, unique: true },
  month:     String,
  year:      Number,
  variables: [VariableSchema],
  fileHashes: { type: [String], default: [], index: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Survey', SurveySchema);