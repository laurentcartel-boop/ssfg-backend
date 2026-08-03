const express = require('express');
const router = express.Router();
const { Course } = require('../models');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

/**
 * GET /api/courses
 * Liste des parcours actifs
 */
router.get('/', async (req, res) => {
  try {
    const courses = await Course.findAll({
      where: { is_active: true },
      order: [['name', 'ASC']],
    });
    res.json({ courses });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * GET /api/courses/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.id);
    if (!course) return res.status(404).json({ error: 'Parcours non trouvé' });
    res.json({ course });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
