const router = require('express').Router();
const ctrl = require('../controllers/approvalController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);
router.get('/list', ctrl.list);
router.post('/decide', ctrl.decide);

module.exports = router;
