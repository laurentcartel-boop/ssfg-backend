const { User } = require('../models');
const { generateToken } = require('../middleware/auth');

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const valid = await user.validatePassword(password);
    if (!valid) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const token = generateToken(user);

    res.json({
      token,
      user: user.toSafeJSON(),
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * GET /api/auth/me
 * Retourne l'utilisateur connecté
 */
async function me(req, res) {
  res.json({ user: req.user.toSafeJSON() });
}

/**
 * POST /api/auth/register  (Super-admin uniquement)
 * Body: { email, password, first_name, last_name, role, gender, birth_date, is_rookie }
 */
async function register(req, res) {
  try {
    const {
      email,
      password,
      first_name,
      last_name,
      role = 'joueur',
      gender,
      birth_date,
      is_rookie = false,
      club_id,
      index_value,
    } = req.body;

    if (!email || !password || !first_name || !last_name) {
      return res.status(400).json({ error: 'Champs obligatoires manquants' });
    }

    if (!['joueur', 'admin', 'super_admin', 'platine_admin'].includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }
    if (req.user.role !== 'platine_admin') {
      if (!['joueur', 'admin'].includes(role)) {
        return res.status(403).json({ error: 'Seul un AdminPlatine peut créer un super-admin ou AdminPlatine' });
      }
    }

    const existing = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      return res.status(409).json({ error: 'Cet email est déjà utilisé' });
    }

    const fold = (s) =>
      String(s || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    const allNames = await User.findAll({
      attributes: ['id', 'email', 'first_name', 'last_name', 'is_active'],
    });
    const sameName = allNames.find(
      (u) => fold(u.first_name) === fold(first_name) && fold(u.last_name) === fold(last_name)
    );
    if (sameName && !req.body.force) {
      return res.status(409).json({
        error: `Un joueur « ${sameName.first_name} ${sameName.last_name} » existe déjà (${sameName.email}${sameName.is_active ? '' : ', désactivé'}). Coche « forcer » seulement si ce n’est vraiment pas un doublon.`,
        existing_id: sameName.id,
      });
    }

    const idx = Number(index_value);
    const user = await User.create({
      email: email.toLowerCase().trim(),
      password_hash: password,
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      role,
      gender: gender || null,
      birth_date: birth_date || null,
      is_rookie: Boolean(is_rookie),
      club_id: club_id || null,
      index_value: Number.isFinite(idx) ? idx : 1.0,
      is_active: true,
      must_change_password: true,
    });

    res.status(201).json({
      user: user.toSafeJSON(),
      message: 'Compte créé avec succès',
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}


/**
 * POST /api/auth/change-password
 * Body: { current_password, new_password }
 * (current_password optionnel si must_change_password)
 */
async function changePassword(req, res) {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'Nouveau mot de passe : 6 caractères minimum' });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    if (!user.must_change_password) {
      if (!current_password) {
        return res.status(400).json({ error: 'Mot de passe actuel requis' });
      }
      const valid = await user.validatePassword(current_password);
      if (!valid) {
        return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
      }
    }

    await user.update({
      password_hash: new_password,
      must_change_password: false,
    });

    res.json({
      message: 'Mot de passe mis à jour',
      user: user.toSafeJSON(),
    });
  } catch (err) {
    console.error('changePassword error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * POST /api/auth/forgot-password
 * Public. N'envoie PAS un nouveau mot de passe : prévient les super-admins + AdminPlatine.
 */
async function forgotPassword(req, res) {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const name = String(req.body.name || '').trim();
    if (email && email.includes('@')) {
      const { Op } = require('sequelize');
      const mods = await User.findAll({
        where: { role: { [Op.in]: ['platine_admin', 'super_admin'] }, is_active: true },
        attributes: ['email'],
      });
      const extra = String(process.env.MAIL_NOTIFY || process.env.PLATINE_EMAILS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const to = [...new Set([...mods.map((u) => u.email).filter(Boolean), ...extra])].filter(
        (e) => e && !String(e).endsWith('@ssfg.local')
      );
      const found = await User.findOne({ where: { email } });
      try {
        const { ClubEventLog } = require('../models');
        await ClubEventLog.create({
          actor_id: found ? found.id : null,
          action: 'password_request',
          entity_type: 'user',
          entity_id: found ? String(found.id) : null,
          note: `${email}${name ? ' — ' + name : ''}`,
          payload: { email, name, user_id: found ? found.id : null },
        });
      } catch (e) {
        console.warn('password_request log', e.message);
      }
      try {
        const { notifyPlatine } = require('../utils/push');
        await notifyPlatine({
          title: 'SSFG — mot de passe',
          body: `${name || email} demande un reset`,
          url: 'https://ssfg.fr/scoring/#/admin/users',
        });
      } catch (e) {
        console.warn('password_request push', e.message);
      }
      if (to.length) {
        const { sendMail } = require('../utils/mailer');
        await sendMail({
          to,
          subject: 'SSFG — demande de mot de passe',
          text: [
            'Un joueur demande un nouveau mot de passe.',
            '',
            `Email saisi : ${email}`,
            name ? `Nom indiqué : ${name}` : '',
            found
              ? `Compte trouvé : ${found.first_name} ${found.last_name} (${found.role})`
              : 'Aucun compte avec cet email.',
            '',
            'Scoring → Joueurs → modifier → nouveau mot de passe.',
            'https://ssfg.fr/scoring/',
          ]
            .filter(Boolean)
            .join('\n'),
        });
      }
    }
    return res.json({
      message: 'Demande envoyée. Un super-admin ou AdminPlatine te recontacte.',
    });
  } catch (err) {
    console.error('forgotPassword:', err);
    return res.json({
      message: 'Demande envoyée. Un super-admin ou AdminPlatine te recontacte.',
    });
  }
}

async function listPasswordRequests(req, res) {
  try {
    const { ClubEventLog } = require('../models');
    const rows = await ClubEventLog.findAll({
      where: { action: 'password_request' },
      order: [['createdAt', 'DESC']],
      limit: 30,
    });
    const open = rows.filter((r) => r.reason !== 'handled');
    res.json({
      count: open.length,
      requests: open.map((r) => ({
        id: r.id,
        email: (r.payload && r.payload.email) || '',
        name: (r.payload && r.payload.name) || r.note || '',
        user_id: (r.payload && r.payload.user_id) || r.entity_id,
        created_at: r.createdAt,
      })),
    });
  } catch (err) {
    console.error('listPasswordRequests', err);
    res.json({ count: 0, requests: [] });
  }
}

async function markPasswordRequest(req, res) {
  try {
    const { ClubEventLog } = require('../models');
    const row = await ClubEventLog.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Introuvable' });
    await row.update({ reason: 'handled' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

module.exports = {
  login,
  me,
  register,
  changePassword,
  forgotPassword,
  listPasswordRequests,
  markPasswordRequest,
};

