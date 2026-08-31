const express = require('express');
const router = express.Router();
const { Course } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const where = {};
    if (!(req.query.all === 'true' && req.user.role === 'super_admin')) {
      where.is_active = true;
    }
    const courses = await Course.findAll({
      where,
      order: [['name', 'ASC']],
    });
    res.json({ courses });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

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

router.post('/', requireRole('super_admin', 'platine_admin'), async (req, res) => {
  try {
    const { name, short_name, holes_data, is_active } = req.body;

    if (!name || !short_name) {
      return res.status(400).json({ error: 'Nom et nom court obligatoires' });
    }
    if (!Array.isArray(holes_data) || holes_data.length !== 18) {
      return res.status(400).json({ error: 'holes_data doit contenir 18 trous' });
    }

    const normalized = holes_data.map((h, i) => ({
      hole: h.hole || i + 1,
      par: Number(h.par),
    }));

    if (normalized.some((h) => !h.par || h.par < 3 || h.par > 6)) {
      return res.status(400).json({ error: 'Chaque par doit être entre 3 et 6' });
    }

    const par_total = normalized.reduce((sum, h) => sum + h.par, 0);

    const course = await Course.create({
      name: name.trim(),
      short_name: short_name.trim(),
      par_total,
      holes_data: normalized,
      is_active: is_active !== false,
    });

    res.status(201).json({ course, message: 'Parcours créé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id', requireRole('super_admin', 'platine_admin'), async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.id);
    if (!course) return res.status(404).json({ error: 'Parcours non trouvé' });

    const { name, short_name, holes_data, is_active } = req.body;
    const updates = {};

    if (name) updates.name = name.trim();
    if (short_name) updates.short_name = short_name.trim();
    if (is_active !== undefined) updates.is_active = Boolean(is_active);

    if (Array.isArray(holes_data)) {
      if (holes_data.length !== 18) {
        return res.status(400).json({ error: 'holes_data doit contenir 18 trous' });
      }
      const normalized = holes_data.map((h, i) => ({
        hole: h.hole || i + 1,
        par: Number(h.par),
      }));
      if (normalized.some((h) => !h.par || h.par < 3 || h.par > 6)) {
        return res.status(400).json({ error: 'Chaque par doit être entre 3 et 6' });
      }
      updates.holes_data = normalized;
      updates.par_total = normalized.reduce((sum, h) => sum + h.par, 0);
    }

    await course.update(updates);
    res.json({ course, message: 'Parcours mis à jour' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
