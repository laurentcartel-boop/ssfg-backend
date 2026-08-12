const { User, IndexHistory } = require('../models');
const { getIndexSeries, getCategories } = require('../services/indexService');
const { Op } = require('sequelize');

/**
 * GET /api/users
 * Liste des joueurs (filtrable)
 * Query: ?search=xxx&role=joueur&active=true
 */
async function listUsers(req, res) {
  try {
    const { search, role, active } = req.query;
    const where = {};

    if (role) where.role = role;
    if (active !== undefined) where.is_active = active === 'true';

    if (search) {
      where[Op.or] = [
        { first_name: { [Op.like]: `%${search}%` } },
        { last_name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
      ];
    }

    const users = await User.findAll({
      where,
      order: [['last_name', 'ASC'], ['first_name', 'ASC']],
      attributes: { exclude: ['password_hash'] },
    });

    res.json({ users });
  } catch (err) {
    console.error('listUsers error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * GET /api/users/:id
 */
async function getUser(req, res) {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password_hash'] },
      include: [
        {
          model: IndexHistory,
          as: 'indexHistory',
          limit: 50,
          order: [['created_at', 'DESC']],
        },
      ],
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const data = user.toJSON();
    data.series = getIndexSeries(user.index_value);
    data.categories = getCategories(user);

    res.json({ user: data });
  } catch (err) {
    console.error('getUser error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * PATCH /api/users/:id
 * Super-admin (ou soi-même pour certains champs)
 */
async function updateUser(req, res) {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const isSelf = req.user.id === user.id;
    const isSuperAdmin = req.user.role === 'super_admin';

    if (!isSelf && !isSuperAdmin) {
      return res.status(403).json({ error: 'Permissions insuffisantes' });
    }

    const allowed = {};
    const body = req.body;

    // Champs modifiables par soi-même ou super-admin
    if (body.first_name) allowed.first_name = body.first_name.trim();
    if (body.last_name) allowed.last_name = body.last_name.trim();
    if (body.gender) allowed.gender = body.gender;
    if (body.birth_date !== undefined) allowed.birth_date = body.birth_date;

    // Champs réservés au super-admin
    if (isSuperAdmin) {
      if (body.role) allowed.role = body.role;
      if (body.is_active !== undefined) allowed.is_active = body.is_active;
      if (body.is_rookie !== undefined) allowed.is_rookie = body.is_rookie;
      if (body.index_value !== undefined) allowed.index_value = body.index_value;
      if (body.email) allowed.email = body.email.toLowerCase().trim();
    }

    // Changement de mot de passe
    if (body.password) {
      if (isSelf || isSuperAdmin) {
        allowed.password_hash = body.password;
      }
    }

    await user.update(allowed);

    res.json({
      user: user.toSafeJSON(),
      message: 'Profil mis à jour',
    });
  } catch (err) {
    console.error('updateUser error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

module.exports = {
  listUsers,
  getUser,
  updateUser,
};
