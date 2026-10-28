const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/chatController');
const { requireAuth } = require('../middleware/auth');

// Each message costs money, so keep a per-IP ceiling on top of the admin limits
const limiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { code: 'rate', message: 'Slow down a little and try again.' } });

router.post('/send', requireAuth, limiter, ctrl.send);

module.exports = router;
