const router = require('express').Router();
const ctrl = require('../controllers/dashboardController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/dashboard', requireAuth, ctrl.dashboard);
router.get('/announcements', requireAuth, ctrl.announcements);
router.post('/announcements/create', requireAuth, requireRole('admin'), ctrl.createAnnouncement);
router.post('/announcements/delete', requireAuth, requireRole('admin'), ctrl.deleteAnnouncement);

module.exports = router;
