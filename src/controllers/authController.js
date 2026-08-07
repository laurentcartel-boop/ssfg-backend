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
    } = req.body;

    if (!email || !password || !first_name || !last_name) {
      return res.status(400).json({ error: 'Champs obligatoires manquants' });
    }

    if (!['joueur', 'admin', 'super_admin'].includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }

    // Seul un super_admin peut créer un admin ou super_admin
    if ((role === 'admin' || role === 'super_admin') && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Seul un super-admin peut créer ce type de compte' });
    }

    const existing = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      return res.status(409).json({ error: 'Cet email est déjà utilisé' });
    }

    const user = await User.create({
      email: email.toLowerCase().trim(),
      password_hash: password,
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      role,
      gender: gender || null,
      birth_date: birth_date || null,
      is_rookie: Boolean(is_rookie),
      index_value: 1.0,
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

module.exports = {
  login,
  me,
  register,
  changePassword,
};

