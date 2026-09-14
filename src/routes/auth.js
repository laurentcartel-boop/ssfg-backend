const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate, requireRole } = require('../middleware/auth');

router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);

router.get('/me', authenticate, authController.me);
router.post('/change-password', authenticate, authController.changePassword);

router.post('/register', authenticate, requireRole('super_admin', 'platine_admin'), authController.register);
router.get(
  '/password-requests',
  authenticate,
  requireRole('super_admin', 'platine_admin'),
  authController.listPasswordRequests
);
router.post(
  '/password-requests/:id/done',
  authenticate,
  requireRole('super_admin', 'platine_admin'),
  authController.markPasswordRequest
);

module.exports = router;
