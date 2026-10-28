const mongoose = require('mongoose');

const ACTIONS = [
  'sign_in',
  'agent_created',
  'agent_updated',
  'agent_published',
  'agent_deleted',
  'knowledge_added',
  'knowledge_deleted',
  'tool_connected',
  'tool_disconnected',
  'approval_decided',
  'conversation_deleted',
  'user_changed',
  'limit_changed'
];

const auditLogSchema = new mongoose.Schema(
  {
    person: { type: String, required: true },          // display name, kept even if the user is later deleted
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, enum: ACTIONS, required: true, index: true },
    target: { type: String, default: '-' },
    details: { type: String, default: '' }
  },
  { timestamps: { createdAt: 'time', updatedAt: false } }
);

auditLogSchema.index({ time: -1 });

// Audit entries are append-only: block updates and deletes at the model level
['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndDelete', 'deleteOne', 'deleteMany'].forEach(op => {
  auditLogSchema.pre(op, function () {
    throw new Error('Audit log entries are read-only.');
  });
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
module.exports.ACTIONS = ACTIONS;
