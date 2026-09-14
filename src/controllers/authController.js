const { User } = require('../models');
const { generateToken } = require('../middleware/auth');

async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (!user || !user.is_active) return res.status(401).json({ error: 'Identifiants incorrects' });
    const valid = await user.validatePassword(password);
    if (!valid) return res.status(401).json({ error: 'Identifiants incorrects' });
    res.json({ token: generateToken(user), user: user.toSafeJSON() });
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
    const { email, password, first_name, last_name, role = 'joueur', gender, birth_date, is_rookie = false, club_id, index_value } = req.body;
    if (!email || !password || !first_name || !last_name) return res.status(400).json({ error: 'Champs obligatoires manquants' });
    if (!['joueur', 'admin', 'super_admin', 'platine_admin'].includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
    if (req.user.role !== 'platine_admin' && !['joueur', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Seul un AdminPlatine peut créer un super-admin ou AdminPlatine' });
    }
    const existing = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé' });
    const sameName = await User.findOne({ where: { first_name: first_name.trim(), last_name: last_name.trim(), is_active: true } });
    if (sameName && !req.body.force) {
      return res.status(409).json({ error: `Un joueur « ${first_name.trim()} ${last_name.trim()} » existe déjà (${sameName.email}). Coche « forcer » si ce n’est pas un doublon.`, existing_id: sameName.id });
    }
    const idx = Number(index_value);
    const user = await User.create({
      email: email.toLowerCase().trim(), password_hash: password,
      first_name: first_name.trim(), last_name: last_name.trim(), role,
      gender: gender || null, birth_date: birth_date || null, is_rookie: Boolean(is_rookie),
      club_id: club_id || null, index_value: Number.isFinite(idx) ? idx : 1.0,
      is_active: true, must_change_password: true,
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
    if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Nouveau mot de passe : 6 caractères minimum' });
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    if (!user.must_change_password) {
      if (!current_password) return res.status(400).json({ error: 'Mot de passe actuel requis' });
      const valid = await user.validatePassword(current_password);
      if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
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
      } catch (e) { console.warn('password_request log', e.message); }
      try {
        const { notifyPlatine } = require('../utils/push');
        await notifyPlatine({ title: 'SSFG — mot de passe', body: `${name || email} demande un reset`, url: 'https://ssfg.fr/scoring/#/admin/users' });
      } catch (e) { console.warn('password_request push', e.message); }
      const mods = await User.findAll({ where: { role: { [Op.in]: ['platine_admin', 'super_admin'] }, is_active: true }, attributes: ['email'] });
      const extra = String(process.env.MAIL_NOTIFY || process.env.PLATINE_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean);
      const to = [...new Set([...mods.map((u) => u.email).filter(Boolean), ...extra])].filter((e) => e && !String(e).endsWith('@ssfg.local'));
      if (to.length) {
        const { sendMail } = require('../utils/mailer');
        await sendMail({ to, subject: 'SSFG — demande de mot de passe', text: `Email : ${email}\n${name}\nhttps://ssfg.fr/scoring/` });
      }
    }
    return res.json({ message: 'Demande envoyée. Un super-admin ou AdminPlatine te recontacte.' });
  } catch (err) {
    console.error('forgotPassword:', err);
    return res.json({ message: 'Demande envoyée. Un super-admin ou AdminPlatine te recontacte.' });
  }
}

async function listPasswordRequests(req, res) {
  try {
    const { ClubEventLog } = require('../models');
    const rows = await ClubEventLog.findAll({ where: { action: 'password_request' }, order: [['createdAt', 'DESC']], limit: 30 });
    const open = rows.filter((r) => r.reason !== 'handled');
    res.json({ count: open.length, requests: open.map((r) => ({ id: r.id, email: (r.payload && r.payload.email) || '', name: (r.payload && r.payload.name) || r.note || '', user_id: (r.payload && r.payload.user_id) || r.entity_id, created_at: r.createdAt })) });
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

module.exports = { login, me, register, changePassword, forgotPassword, listPasswordRequests, markPasswordRequest };
