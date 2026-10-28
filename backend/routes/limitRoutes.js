const router = require('express').Router();
const ctrl = require('../controllers/limitController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('admin'));
router.get('/get', ctrl.get);
router.post('/save', ctrl.save);

module.exports = router;
