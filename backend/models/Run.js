const mongoose = require('mongoose');
const { Schema } = mongoose;

const stepSchema = new Schema(
  {
    type: { type: String, enum: ['model', 'tool', 'approval'], required: true },
    name: String,
    detail: String,
    status: String,            // done | failed | blocked | waiting | approved | rejected
    ms: Number,
    error: String,
    approvalId: Schema.Types.ObjectId,
    time: { type: Date, default: Date.now }
  },
  { _id: false }
);

const runSchema = new Schema(
  {
    agentId: { type: Schema.Types.ObjectId, required: true, index: true },
    agentName: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    userName: { type: String, required: true },
    conversationId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['running', 'waiting', 'done', 'failed', 'stopped'], default: 'running', index: true },
    steps: [stepSchema],
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
    error: { type: String, default: '' },
    // Working state of the agent loop; kept only while the run is unfinished (needed to resume after an approval)
    state: { type: Schema.Types.Mixed, select: false }
  },
  { timestamps: true }
);
runSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Run', runSchema);
