const mongoose = require('mongoose');
const { Schema } = mongoose;

const knowledgeSchema = new Schema(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ['pdf', 'docx', 'text', 'image', 'web'], required: true },
    size: { type: Number, default: 0 },
    url: { type: String, default: '' },
    filePath: { type: String, default: '' },
    status: { type: String, enum: ['Indexing', 'Ready', 'Failed'], default: 'Indexing', index: true },
    error: { type: String, default: '' },
    chunks: { type: Number, default: 0 },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ownerName: { type: String, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Knowledge', knowledgeSchema);
