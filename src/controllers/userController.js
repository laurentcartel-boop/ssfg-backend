const { User, IndexHistory, Club } = require('../models');
const { getIndexSeries, getCategories } = require('../services/indexService');
const { Op } = require('sequelize');

/**
 * GET /api/users
 * Liste des joueurs (filtrable)
 * Query: ?search=xxx&role=joueur&active=true
 */
async function listUsers(req, res) {
  try {
    const { search, role, active, club_id } = req.query;
    const where = {};

    if (role) where.role = role;
    if (club_id) where.club_id = club_id;
    // Admin club : uniquement les joueurs de son club
    if (req.user.role === 'admin' && req.user.club_id) {
      where.club_id = req.user.club_id;
    }
    if (active === 'false') where.is_active = false;
    else if (active !== 'all') where.is_active = true;

    if (search) {
      where[Op.or] = [
        { first_name: { [Op.like]: `%${search}%` } },
        { last_name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
      ];
    }

    const users = await User.findAll({
      where,
      include: [
        {
          model: Club,
          as: 'club',
          attributes: ['id', 'code', 'name', 'short_name'],
          required: false,
        },
      ],
      order: [['last_name', 'ASC'], ['first_name', 'ASC']],
      attributes: { exclude: ['password_hash', 'card_photo'] },
    });

    res.json({
      users: users.map((u) => {
        const j = u.toJSON();
        delete j.password_hash;
        j.club = u.club
          ? {
              id: u.club.id,
              code: u.club.code,
              name: u.club.name,
              short_name: u.club.short_name,
            }
          : null;
        return j;
      }),
    });
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
    const isPlatine = req.user.role === 'platine_admin';
    const isSuperAdmin = req.user.role === 'super_admin' || isPlatine;
    const isClubAdmin =
      req.user.role === 'admin' &&
      req.user.club_id &&
      user.club_id === req.user.club_id;

    if (!isSelf && !isSuperAdmin && !isClubAdmin) {
      return res.status(403).json({ error: 'Permissions insuffisantes' });
    }

    const allowed = {};
    const body = req.body;

    // Champs modifiables par soi-même ou super-admin
    if (body.first_name) allowed.first_name = body.first_name.trim();
    if (body.last_name) allowed.last_name = body.last_name.trim();
    if (body.gender) allowed.gender = body.gender;
    if (body.birth_date !== undefined) allowed.birth_date = body.birth_date;

    if (isSuperAdmin) {
      if (body.club_id !== undefined) allowed.club_id = body.club_id || null;
      if (body.is_active !== undefined) allowed.is_active = body.is_active;
      if (body.is_rookie !== undefined) allowed.is_rookie = body.is_rookie;
      if (body.email) allowed.email = body.email.toLowerCase().trim();
    }

    if (isPlatine) {
      if (body.role) allowed.role = body.role;
      if (body.index_value !== undefined) allowed.index_value = body.index_value;
    }

    if (body.password) {
      if (isSelf || isSuperAdmin) {
        allowed.password_hash = body.password;
        if (isSuperAdmin && !isSelf) allowed.must_change_password = true;
      }
    }

    const prevIndex = Number(user.index_value);
    if (allowed.index_value !== undefined) {
      allowed.index_value = Math.round(Number(allowed.index_value) * 10) / 10;
    }
    await user.update(allowed);
    if (
      allowed.index_value !== undefined &&
      Number(allowed.index_value) !== prevIndex
    ) {
      try {
        await IndexHistory.create({
          user_id: user.id,
          old_index: prevIndex,
          new_index: allowed.index_value,
          change: Math.round((allowed.index_value - prevIndex) * 10) / 10,
          reason: 'manual',
        });
      } catch (e) {
        console.warn('index history', e.message);
      }
    }

    res.json({
      user: user.toSafeJSON(),
      message: 'Profil mis à jour',
    });
  } catch (err) {
    console.error('updateUser error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function listClubs(req, res) {
  try {
    if (!Club) {
      return res.status(500).json({ error: 'Modèle Club absent' });
    }
    let clubs = await Club.findAll({
      order: [['sort_order', 'ASC'], ['name', 'ASC']],
    });
    // Filtre is_active si le champ existe
    clubs = clubs.filter((c) => c.is_active !== false);
    res.json({
      clubs: clubs.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        short_name: c.short_name,
      })),
    });
  } catch (err) {
    console.error('listClubs error:', err);
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}

/**
 * DELETE /api/users/:id
 * Platine / super-admin uniquement.
 * Si le joueur a déjà des parties → désactivation (historique conservé).
 * Sinon suppression définitive.
 */
async function deleteUser(req, res) {
  try {
    if (!['platine_admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Seul un Admin Platine peut supprimer un joueur' });
    }
    if (String(req.params.id) === String(req.user.id)) {
      return res.status(400).json({ error: 'Tu ne peux pas supprimer ton propre compte' });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'Joueur introuvable' });
    if (user.role === 'platine_admin' && req.user.role !== 'platine_admin') {
      return res.status(403).json({ error: 'Impossible de supprimer un Admin Platine' });
    }

    const models = require('../models');
    const played = await models.RoundPlayer.count({ where: { user_id: user.id } });
    const purge = req.query.purge === '1' || req.body?.purge === true;

    if (played > 0 && !purge) {
      await user.update({
        is_active: false,
        email: user.email.startsWith('deleted_')
          ? user.email
          : `deleted_${Date.now()}_${user.email}`,
      });
      return res.json({
        message: `${user.first_name} ${user.last_name} désactivé (${played} partie(s) conservées). Pour tout effacer : Effacer définitivement.`,
        soft: true,
        played,
      });
    }

    if (purge) {
      const rps = await models.RoundPlayer.findAll({ where: { user_id: user.id } });
      for (const rp of rps) {
        if (models.HoleScore) {
          await models.HoleScore.destroy({ where: { round_player_id: rp.id } });
        }
        await rp.destroy();
      }
    }
    await user.destroy();
    res.json({
      message: `${user.first_name} ${user.last_name} supprimé définitivement`,
      soft: false,
    });
  } catch (err) {
    console.error('deleteUser', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * GET /api/users/rookies-due
 * Rookies dont le compte a plus de 12 mois.
 */
async function listRookiesDue(req, res) {
  try {
    if (!['admin', 'super_admin', 'platine_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Permissions insuffisantes' });
    }
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const rows = await User.findAll({
      where: {
        is_rookie: true,
        is_active: true,
        createdAt: { [Op.lte]: cutoff },
      },
      attributes: { exclude: ['password_hash'] },
      include: [
        {
          model: Club,
          as: 'club',
          attributes: ['id', 'code', 'short_name'],
          required: false,
        },
      ],
      order: [['createdAt', 'ASC']],
    });
    res.json({
      count: rows.length,
      cutoff: cutoff.toISOString().slice(0, 10),
      rookies: rows.map((u) => {
        const created = u.createdAt || u.created_at;
        const months = created
          ? Math.floor((Date.now() - new Date(created).getTime()) / (30.44 * 24 * 3600 * 1000))
          : null;
        return {
          id: u.id,
          first_name: u.first_name,
          last_name: u.last_name,
          email: u.email,
          club: u.club ? u.club.short_name || u.club.code : null,
          created_at: created,
          months,
        };
      }),
    });
  } catch (err) {
    console.error('listRookiesDue', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function clearRookie(req, res) {
  try {
    if (!['admin', 'super_admin', 'platine_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Permissions insuffisantes' });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'Joueur introuvable' });
    await user.update({ is_rookie: false });
    res.json({
      message: `${user.first_name} ${user.last_name} n’est plus rookie`,
      user: user.toSafeJSON(),
    });
  } catch (err) {
    console.error('clearRookie', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function snapshotUser(id) {
  const models = require('../models');
  const u = await User.findByPk(id, {
    attributes: { exclude: ['password_hash'] },
    include: [{ model: Club, as: 'club', required: false }],
  });
  if (!u) return null;
  const rp = await models.RoundPlayer.count({ where: { user_id: id } });
  const ih = await models.IndexHistory.count({ where: { user_id: id } });
  return {
    id: u.id,
    first_name: u.first_name,
    last_name: u.last_name,
    email: u.email,
    role: u.role,
    index_value: u.index_value,
    is_rookie: u.is_rookie,
    is_active: u.is_active,
    club: u.club ? u.club.short_name || u.club.code : 'Sans club',
    created_at: u.createdAt || u.created_at,
    nickname: u.card_nickname,
    has_photo: !!u.card_photo,
    rounds: rp,
    index_events: ih,
  };
}

async function compareUsers(req, res) {
  try {
    if (!['platine_admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'AdminPlatine uniquement' });
    }
    const a = req.query.a || req.query.keep_id;
    const b = req.query.b || req.query.drop_id;
    if (!a || !b || a === b) return res.status(400).json({ error: 'Deux joueurs distincts requis' });
    const left = await snapshotUser(a);
    const right = await snapshotUser(b);
    if (!left || !right) return res.status(404).json({ error: 'Joueur introuvable' });
    res.json({ a: left, b: right });
  } catch (err) {
    console.error('compareUsers', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function reassign(model, field, from, to) {
  if (!model || !model.update) return 0;
  try {
    const [n] = await model.update({ [field]: to }, { where: { [field]: from } });
    return n || 0;
  } catch (e) {
    console.warn('reassign', model.name || field, e.message);
    return 0;
  }
}

async function mergeUsers(req, res) {
  try {
    if (!['platine_admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'AdminPlatine uniquement' });
    }
    const keepId = req.body.keep_id;
    const dropId = req.body.drop_id;
    if (!keepId || !dropId || keepId === dropId) {
      return res.status(400).json({ error: 'keep_id et drop_id distincts requis' });
    }
    if (String(dropId) === String(req.user.id)) {
      return res.status(400).json({ error: 'Tu ne peux pas fusionner ton compte connecté vers un autre' });
    }
    const keep = await User.findByPk(keepId);
    const drop = await User.findByPk(dropId);
    if (!keep || !drop) return res.status(404).json({ error: 'Joueur introuvable' });

    const m = require('../models');
    const moved = {};

    // Inscriptions : si les deux sont inscrits, on jette le clone
    if (m.CompetitionRegistration) {
      const keepRegs = await m.CompetitionRegistration.findAll({ where: { user_id: keepId } });
      const keepComp = new Set(keepRegs.map((r) => r.competition_id));
      const dropRegs = await m.CompetitionRegistration.findAll({ where: { user_id: dropId } });
      for (const r of dropRegs) {
        if (keepComp.has(r.competition_id)) await r.destroy();
        else await r.update({ user_id: keepId });
      }
      moved.competitions = dropRegs.length;
    }
    if (m.MarcassinsRegistration) {
      const keepRegs = await m.MarcassinsRegistration.findAll({ where: { user_id: keepId } });
      const keepEd = new Set(keepRegs.map((r) => r.edition_id));
      const dropRegs = await m.MarcassinsRegistration.findAll({ where: { user_id: dropId } });
      for (const r of dropRegs) {
        if (keepEd.has(r.edition_id)) await r.destroy();
        else await r.update({ user_id: keepId });
      }
    }

    moved.rounds = await reassign(m.RoundPlayer, 'user_id', dropId, keepId);
    moved.index_history = await reassign(m.IndexHistory, 'user_id', dropId, keepId);
    moved.comments = await reassign(m.RoundComment, 'user_id', dropId, keepId);
    moved.exploits = await reassign(m.RoundExploit, 'user_id', dropId, keepId);
    moved.chat = await reassign(m.ChatMessage, 'user_id', dropId, keepId);
    await reassign(m.ChatRead, 'user_id', dropId, keepId);
    await reassign(m.ArticleComment, 'user_id', dropId, keepId);
    await reassign(m.PushSubscription, 'user_id', dropId, keepId);
    await reassign(m.Round, 'created_by', dropId, keepId);
    await reassign(m.Round, 'scoring_user_id', dropId, keepId);
    if (m.MarcassinsTeam) {
      await reassign(m.MarcassinsTeam, 'player_a_id', dropId, keepId);
      await reassign(m.MarcassinsTeam, 'player_b_id', dropId, keepId);
    }
    if (m.MatchPlayMatch) {
      await reassign(m.MatchPlayMatch, 'player_a_id', dropId, keepId);
      await reassign(m.MatchPlayMatch, 'player_b_id', dropId, keepId);
    }

    const cardPatch = {};
    if (!keep.card_photo && drop.card_photo) cardPatch.card_photo = drop.card_photo;
    if (!keep.card_nickname && drop.card_nickname) cardPatch.card_nickname = drop.card_nickname;
    if (!keep.card_bio && drop.card_bio) cardPatch.card_bio = drop.card_bio;
    if (Object.keys(cardPatch).length) await keep.update(cardPatch);

    await drop.update({
      is_active: false,
      is_rookie: false,
      email: `merged_${Date.now()}_${String(drop.email).slice(0, 80)}`,
    });

    res.json({
      message: `${drop.last_name} ${drop.first_name} fusionné dans ${keep.last_name} ${keep.first_name}`,
      keep_id: keep.id,
      drop_id: drop.id,
      moved,
    });
  } catch (err) {
    console.error('mergeUsers', err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}

module.exports = {
  listClubs,
  listUsers,
  getUser,
  updateUser,
  deleteUser,
  listRookiesDue,
  clearRookie,
  compareUsers,
  mergeUsers,
};
