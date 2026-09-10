const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const albumController = require('../controllers/albumController');
router.use(authenticate);
router.get('/', albumController.listAlbum);
router.patch('/me', albumController.updateMyCard);
router.patch('/:id', albumController.updateMyCard);
module.exports = router;
