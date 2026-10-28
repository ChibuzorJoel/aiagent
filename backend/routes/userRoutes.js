const router = require('express').Router();
const ctrl = require('../controllers/userController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('admin'));
router.get('/list', ctrl.list);
router.post('/create', ctrl.create);
router.post('/update', ctrl.update);

module.exports = router;
