const router = require('express').Router();
const ctrl = require('../controllers/runController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('builder', 'admin'));
router.get('/list', ctrl.list);
router.get('/get', ctrl.get);

module.exports = router;
