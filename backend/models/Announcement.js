const mongoose = require('mongoose');

module.exports = mongoose.model(
  'Announcement',
  new mongoose.Schema(
    { title: { type: String, required: true, maxlength: 120 }, body: { type: String, default: '', maxlength: 1000 }, createdBy: String },
    { timestamps: true }
  )
);
