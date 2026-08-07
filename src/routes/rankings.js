const express = require('express');
const router = express.Router();
const rankingController = require('../controllers/rankingController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/', rankingController.getIndexRanking);
router.get('/top', rankingController.getTop20);
router.get('/season-years', rankingController.getSeasonYears);
router.get('/season/:year', rankingController.getSeasonRanking);
router.get('/categories/:category', rankingController.getCategoryRanking);

module.exports = router;
