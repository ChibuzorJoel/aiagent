

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ['member', 'builder', 'admin'], default: 'member' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);