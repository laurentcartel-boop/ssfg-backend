const express = require('express');
const router = express.Router();
const rankingController = require('../controllers/rankingController');
const { authenticate } = require('../middleware/auth');

// Classements accessibles à tous les utilisateurs connectés
router.use(authenticate);

router.get('/', rankingController.getIndexRanking);
router.get('/top', rankingController.getTop20);
router.get('/categories/:category', rankingController.getCategoryRanking);

module.exports = router;
