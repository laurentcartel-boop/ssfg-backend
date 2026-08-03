const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate, requireRole } = require('../middleware/auth');

// Public
router.post('/login', authController.login);

// Authenticated
router.get('/me', authenticate, authController.me);

// Super-admin only (création de comptes)
router.post('/register', authenticate, requireRole('super_admin'), authController.register);

module.exports = router;
