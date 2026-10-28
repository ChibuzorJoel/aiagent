const router = require('express').Router();
const ctrl = require('../controllers/knowledgeController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('builder', 'admin'));
router.get('/list', ctrl.list);
router.post('/add', ctrl.handleUpload, ctrl.add);
router.post('/reindex', ctrl.reindex);
router.post('/delete', ctrl.remove);

module.exports = router;
