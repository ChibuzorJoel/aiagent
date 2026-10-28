const mongoose = require('mongoose');

const chunkSchema = new mongoose.Schema({
  knowledgeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Knowledge', required: true, index: true },
  text: { type: String, required: true }
});
chunkSchema.index({ text: 'text' });

module.exports = mongoose.model('KnowledgeChunk', chunkSchema);
