require('dotenv').config();
require('./utils/fetchPolyfill');

const fs = require('fs');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { startRetention } = require('./utils/retention');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Basic brute-force protection on login endpoints
app.use('/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth', require('./routes/authRoutes'));
app.use('/audit', require('./routes/auditRoutes'));
app.use('/agents', require('./routes/agentRoutes'));
app.use('/knowledge', require('./routes/knowledgeRoutes'));
app.use('/tools', require('./routes/toolRoutes'));
app.use('/conversations', require('./routes/conversationRoutes'));
app.use('/chat', require('./routes/chatRoutes'));
app.use('/approvals', require('./routes/approvalRoutes'));
app.use('/runs', require('./routes/runRoutes'));
app.use('/usage', require('./routes/usageRoutes'));
app.use('/users', require('./routes/userRoutes'));
app.use('/limits', require('./routes/limitRoutes'));
app.use('/', require('./routes/dashboardRoutes')); // /dashboard and /announcements

// 404
app.use((req, res) => res.status(404).json({ code: 'not_found', message: 'Route not found.' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return res.end();
  res.status(500).json({ code: 'server', message: 'Something went wrong.' });
});

fs.mkdirSync(process.env.UPLOAD_DIR || 'uploads', { recursive: true });

const PORT = process.env.PORT || 3000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    startRetention();
    app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
