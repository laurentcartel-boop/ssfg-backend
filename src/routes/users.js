const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, requireRole } = require('../middleware/auth');

// Toutes les routes users nécessitent d'être connecté
router.use(authenticate);

// Liste des joueurs (admin + super_admin pour gérer les parties)
router.get('/clubs/list', userController.listClubs);
router.get('/', requireRole('admin', 'super_admin'), userController.listUsers);

// Profil d'un utilisateur
router.get('/:id', userController.getUser);

// Mise à jour
router.patch('/:id', userController.updateUser);

module.exports = router;
