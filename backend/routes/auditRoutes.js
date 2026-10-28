const router = require('express').Router();
const ctrl = require('../controllers/auditController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/list', requireAuth, requireRole('admin'), ctrl.list);

module.exports = router;
