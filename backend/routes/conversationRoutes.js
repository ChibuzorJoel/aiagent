const router = require('express').Router();
const ctrl = require('../controllers/conversationController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);
router.get('/list', ctrl.list);
router.get('/get', ctrl.get);
router.post('/rename', ctrl.rename);
router.post('/delete', ctrl.remove);

module.exports = router;
