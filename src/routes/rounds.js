const express = require('express');
const router = express.Router();
const roundController = require('../controllers/roundController');
const { authenticate, requireRole } = require('../middleware/auth');

// Toutes les routes nécessitent d'être connecté
router.use(authenticate);

// Liste et détail
router.get('/', roundController.listRounds);
router.get('/:id', roundController.getRound);

// Création (Admin + Super-admin)
router.post('/', requireRole('admin', 'super_admin'), roundController.createRound);

// Ajouter un joueur (Admin + Super-admin)
router.post('/:id/players', requireRole('admin', 'super_admin'), roundController.addPlayer);

// Saisie des scores (joueur de la partie ou admin)
router.put('/:id/scores', roundController.updateHoleScores);

// Clôture (Super-admin uniquement)
router.post('/:id/close', requireRole('super_admin'), roundController.closeRound);

module.exports = router;
