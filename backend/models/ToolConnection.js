const mongoose = require('mongoose');

const toolConnectionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    connected: { type: Boolean, default: false },
    updatedBy: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ToolConnection', toolConnectionSchema);
