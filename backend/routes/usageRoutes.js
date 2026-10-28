const router = require('express').Router();
const ctrl = require('../controllers/usageController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/summary', requireAuth, requireRole('builder', 'admin'), ctrl.summary);

module.exports = router;
