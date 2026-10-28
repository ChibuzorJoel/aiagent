const mongoose = require('mongoose');
const { Schema } = mongoose;

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent' },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    text: { type: String, required: true },
    tools: [{ _id: false, name: String, ms: Number, ok: Boolean }],
    runId: { type: Schema.Types.ObjectId, ref: 'Run' }
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } }
);
messageSchema.index({ userId: 1, role: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
