const express = require('express');
const router = express.Router();
const competitionController = require('../controllers/competitionController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

router.get('/', competitionController.listCompetitions);
router.get('/:id/registrations', competitionController.listRegistrations);
router.post('/:id/registrations', requireRole('super_admin', 'platine_admin'), competitionController.addRegistrations);
router.delete('/:id/registrations/:userId', requireRole('super_admin', 'platine_admin'), competitionController.removeRegistration);
router.patch('/:id/forced-groups', requireRole('super_admin', 'platine_admin'), competitionController.setForcedGroups);
router.post('/:id/compose-squads', requireRole('super_admin', 'platine_admin'), competitionController.composeSquads);
router.get('/:id', competitionController.getCompetition);
router.post('/', requireRole('super_admin', 'platine_admin'), competitionController.createCompetition);
router.post('/:id/squads', requireRole('super_admin', 'platine_admin'), competitionController.addSquad);
router.patch('/:id/squads/:squadId', requireRole('super_admin', 'platine_admin'), competitionController.updateSquad);
router.delete('/:id/squads/:squadId', requireRole('super_admin', 'platine_admin'), competitionController.deleteSquad);
router.post('/:id/launch', requireRole('super_admin', 'platine_admin'), competitionController.launchCompetition);
router.post('/:id/close', requireRole('super_admin', 'platine_admin'), competitionController.closeCompetition);
router.delete('/:id', requireRole('super_admin', 'platine_admin'), competitionController.deleteCompetition);

module.exports = router;
