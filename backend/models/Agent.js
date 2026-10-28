const mongoose = require('mongoose');
const { Schema } = mongoose;

const agentToolSchema = new Schema(
  { key: { type: String, required: true }, mode: { type: String, enum: ['ask', 'allowed'], default: 'ask' } },
  { _id: false }
);

const agentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    purpose: { type: String, default: '', maxlength: 200 },
    color: { type: String, default: '#4338ca' },
    instructions: { type: String, default: '', maxlength: 8000 },
    knowledgeIds: [{ type: Schema.Types.ObjectId, ref: 'Knowledge' }],
    tools: [agentToolSchema],
    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ownerName: { type: String, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Agent', agentSchema);
