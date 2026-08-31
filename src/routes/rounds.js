const express = require('express');
const router = express.Router();
const roundController = require('../controllers/roundController');
const { authenticate, requireRole } = require('../middleware/auth');
const { Round, RoundPlayer } = require('../models');

router.use(authenticate);

router.get('/', roundController.listRounds);
router.get('/exploits/album', roundController.listExploitsAlbum);
router.get('/:id/comments', roundController.listComments);
router.get('/:id/exploits', roundController.listExploits);
router.post('/:id/exploits', roundController.addExploit);
router.put('/:id/exploits/:exploitId', roundController.updateExploit);
router.delete('/:id/exploits/:exploitId', roundController.deleteExploit);
router.post('/:id/comments', roundController.addComment);
router.delete('/:id/comments/:commentId', roundController.deleteComment);
router.get('/:id', roundController.getRound);

// Création : admin pour libre/competition, tout joueur pour entrainement
router.post('/', roundController.createRound);

router.post('/:id/players', requireRole('admin', 'super_admin', 'platine_admin'), roundController.addPlayer);
router.delete('/:id/players/:userId', requireRole('admin', 'super_admin', 'platine_admin'), roundController.removePlayer);

router.put('/:id/scores', roundController.updateHoleScores);
router.patch('/:id/investigate', requireRole('super_admin', 'platine_admin'), roundController.setInvestigation);
router.delete('/:id', requireRole('super_admin', 'platine_admin'), roundController.deleteRound);
router.post('/:id/remove', requireRole('super_admin', 'platine_admin'), roundController.deleteRound);
router.post('/:id/players/:userId/dnf', roundController.setPlayerDnf);

// Clôture : super-admin OU joueur de la partie si entraînement
router.post('/:id/close', async (req, res, next) => {
  try {
    if (['admin', 'super_admin', 'platine_admin'].includes(req.user.role)) {
      return roundController.closeRound(req, res, next);
    }
    return res.status(403).json({ error: 'Clôture réservée à un admin' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
