const router = require('express').Router();
const ctrl = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

router.post('/request-code', ctrl.requestCode);
router.post('/verify-code', ctrl.verifyCode);
router.get('/me', requireAuth, ctrl.me);
router.post('/profile', requireAuth, ctrl.updateProfile);

module.exports = router;
