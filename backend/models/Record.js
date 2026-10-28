const mongoose = require('mongoose');

// Rows created by the "Create a record" tool
module.exports = mongoose.model(
  'Record',
  new mongoose.Schema(
    {
      title: { type: String, required: true },
      data: mongoose.Schema.Types.Mixed,
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent' }
    },
    { timestamps: true }
  )
);
