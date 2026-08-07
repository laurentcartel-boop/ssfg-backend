const express = require('express');
const router = express.Router();
const competitionController = require('../controllers/competitionController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

router.get('/', competitionController.listCompetitions);
router.get('/:id', competitionController.getCompetition);
router.post('/', requireRole('admin', 'super_admin'), competitionController.createCompetition);
router.post('/:id/squads', requireRole('admin', 'super_admin'), competitionController.addSquad);
router.post('/:id/close', requireRole('super_admin'), competitionController.closeCompetition);

module.exports = router;
