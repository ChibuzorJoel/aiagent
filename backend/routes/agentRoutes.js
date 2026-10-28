const router = require('express').Router();
const ctrl = require('../controllers/agentController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);
router.get('/list', ctrl.list);                 // everyone: members only see published agents
router.get('/get', ctrl.get);
router.post('/create', requireRole('builder', 'admin'), ctrl.create);
router.post('/update', requireRole('builder', 'admin'), ctrl.update);
router.post('/publish', requireRole('builder', 'admin'), ctrl.publish);
router.post('/test', requireRole('builder', 'admin'), ctrl.test);
router.post('/delete', requireRole('builder', 'admin'), ctrl.remove);

module.exports = router;
