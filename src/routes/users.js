const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

router.get('/clubs/list', userController.listClubs);
router.get('/rookies-due', requireRole('admin', 'super_admin', 'platine_admin'), userController.listRookiesDue);
router.get('/compare', requireRole('platine_admin', 'super_admin'), userController.compareUsers);
router.post('/merge', requireRole('platine_admin', 'super_admin'), userController.mergeUsers);
router.post('/:id/clear-rookie', requireRole('admin', 'super_admin', 'platine_admin'), userController.clearRookie);
router.get('/', requireRole('admin', 'super_admin', 'platine_admin'), userController.listUsers);
router.get('/:id', userController.getUser);
router.patch('/:id', userController.updateUser);
router.delete('/:id', requireRole('platine_admin', 'super_admin'), userController.deleteUser);

module.exports = router;
