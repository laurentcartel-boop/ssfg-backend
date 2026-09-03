const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/holes', statsController.getHoleStats);
router.get('/players', statsController.listStatPlayers);

module.exports = router;
