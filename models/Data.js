// models/Data.js
const mongoose = require('mongoose');

// Schema sem campos fixos (cada objeto do JSON será armazenado como documento)
const DataSchema = new mongoose.Schema({}, { strict: false });

module.exports = mongoose.model('Data', DataSchema);