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
router.delete('/:id/exploits/:exploitId', roundController.deleteExploit);
router.post('/:id/comments', roundController.addComment);
router.delete('/:id/comments/:commentId', roundController.deleteComment);
router.get('/:id', roundController.getRound);

// Création : admin pour libre/competition, tout joueur pour entrainement
router.post('/', async (req, res, next) => {
  if (req.body?.type === 'entrainement') {
    return roundController.createRound(req, res, next);
  }
  return requireRole('admin', 'super_admin')(req, res, () =>
    roundController.createRound(req, res, next)
  );
});

router.post('/:id/players', requireRole('admin', 'super_admin'), roundController.addPlayer);
router.delete('/:id/players/:userId', requireRole('admin', 'super_admin'), roundController.removePlayer);

router.put('/:id/scores', roundController.updateHoleScores);
router.delete('/:id', requireRole('super_admin'), roundController.deleteRound);
router.post('/:id/players/:userId/dnf', roundController.setPlayerDnf);

// Clôture : super-admin OU joueur de la partie si entraînement
router.post('/:id/close', async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      return roundController.closeRound(req, res, next);
    }
    const round = await Round.findByPk(req.params.id, {
      include: [{ model: RoundPlayer, as: 'players' }],
    });
    if (!round) return res.status(404).json({ error: 'Partie non trouvée' });
    if (round.type === 'entrainement') {
      const isPlayer = (round.players || []).some((p) => p.user_id === req.user.id);
      if (isPlayer) return roundController.closeRound(req, res, next);
    }
    return res.status(403).json({ error: 'Clôture réservée au super-admin' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
