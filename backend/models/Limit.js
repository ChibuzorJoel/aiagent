const mongoose = require('mongoose');

// One document (key = "global") holds the system-wide limits and policies. 0 means "no limit".
const limitSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    monthlyCostCap: { type: Number, default: 0, min: 0 },
    dailyMessageCap: { type: Number, default: 0, min: 0 },
    blockedTools: [String],
    alwaysApproveTools: [String],
    retentionDays: { type: Number, default: 90, min: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Limit', limitSchema);
