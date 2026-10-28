const mongoose = require('mongoose');

const loginCodeSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  // MongoDB deletes the document automatically once this time passes
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
});

module.exports = mongoose.model('LoginCode', loginCodeSchema);
