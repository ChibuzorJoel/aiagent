const router = require('express').Router();
const ctrl = require('../controllers/toolController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('builder', 'admin'));
router.get('/list', ctrl.list);
router.post('/connect', ctrl.connect);
router.post('/disconnect', ctrl.disconnect);
router.post('/test', ctrl.test);

module.exports = router;
