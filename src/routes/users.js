const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

router.get('/clubs/list', userController.listClubs);
router.get('/', requireRole('admin', 'super_admin', 'platine_admin'), userController.listUsers);
router.get('/:id', userController.getUser);
router.patch('/:id', userController.updateUser);
router.delete('/:id', requireRole('platine_admin', 'super_admin'), userController.deleteUser);

module.exports = router;
