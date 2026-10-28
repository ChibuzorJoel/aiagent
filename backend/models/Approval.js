const mongoose = require('mongoose');
const { Schema } = mongoose;

const approvalSchema = new Schema(
  {
    agentId: { type: Schema.Types.ObjectId, required: true, index: true },
    agentName: String,
    conversationId: { type: Schema.Types.ObjectId, required: true, index: true },
    runId: { type: Schema.Types.ObjectId, required: true },
    toolUseId: { type: String, required: true },
    toolKey: { type: String, required: true },
    toolName: String,
    description: String,             // plain-language description of the action
    input: Schema.Types.Mixed,
    requestedBy: { type: Schema.Types.ObjectId, required: true, index: true },
    requestedByName: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    reason: { type: String, default: '' },
    decidedBy: Schema.Types.ObjectId,
    decidedByName: String,
    decidedAt: Date
  },
  { timestamps: true }
);

module.exports = mongoose.model('Approval', approvalSchema);
