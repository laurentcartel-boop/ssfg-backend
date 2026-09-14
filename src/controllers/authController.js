const { User } = require('../models');
const { generateToken } = require('../middleware/auth');

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
    res.json({ token, user: user.toSafeJSON() });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function me(req, res) {
  res.json({ user: req.user.toSafeJSON() });
}

async function register(req, res) {
  try {
    const {
      email, password, first_name, last_name,
      role = 'joueur', gender, birth_date, is_rookie = false, club_id, index_value,
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
    const sameName = await User.findOne({
      where: { first_name: first_name.trim(), last_name: last_name.trim(), is_active: true },
    });
    if (sameName && !req.body.force) {
      return res.status(409).json({
        error: `Un joueur « ${first_name.trim()} ${last_name.trim()} » existe déjà (${sameName.email}). Coche « forcer » si ce n’est pas un doublon.`,
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
    res.status(201).json({ user: user.toSafeJSON(), message: 'Compte créé avec succès' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

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
    await user.update({ password_hash: new_password, must_change_password: false });
    res.json({ message: 'Mot de passe mis à jour', user: user.toSafeJSON() });
  } catch (err) {
    console.error('changePassword error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

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
          ].filter(Boolean).join('\n'),
        });
      }
    }
    return res.json({ message: 'Demande envoyée. Un super-admin ou AdminPlatine te recontacte.' });
  } catch (err) {
    console.error('forgotPassword:', err);
    return res.json({ message: 'Demande envoyée. Un super-admin ou AdminPlatine te recontacte.' });
  }
}

module.exports = { login, me, register, changePassword, forgotPassword };
