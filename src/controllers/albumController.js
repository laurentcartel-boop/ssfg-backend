const { User, Club, HoleScore, RoundPlayer, Round } = require('../models');

function classify(score, par) {
  const s = Number(score);
  const p = Number(par) || 4;
  if (!s) return null;
  if (s >= 10) return 'croix';
  if (s === 1) return 'hio';
  const d = s - p;
  if (d <= -3) return 'albatross';
  if (d === -2) return 'eagle';
  if (d === -1) return 'birdie';
  if (d === 0) return 'par';
  if (d === 1) return 'bogey';
  if (d === 2) return 'double';
  return 'worse';
}

function emptyStats() {
  return { holes: 0, hio: 0, albatross: 0, eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0, worse: 0, croix: 0 };
}

function badge(user, stats) {
  const idx = Number(user.index_value);
  if (user.is_rookie) return 'Rookie';
  if (idx < 0) return 'Master';
  if ((stats.hio || 0) + (stats.albatross || 0) > 0) return 'Excellent';
  if ((stats.eagle || 0) >= 2) return 'Performer';
  if ((stats.holes || 0) >= 36 && idx <= 5) return 'Regulier';
  if (idx > 5) return 'En progres';
  return 'Joueur';
}

async function statsByUser() {
  const rows = await HoleScore.findAll({
    include: [{
      model: RoundPlayer,
      as: 'roundPlayer',
      required: true,
      include: [
        { model: Round, as: 'round', required: true, attributes: ['id', 'status'] },
        { model: User, as: 'user', required: true, attributes: ['id'] },
      ],
    }],
    limit: 40000,
  });
  const map = {};
  rows.forEach((hs) => {
    const st = hs.roundPlayer && hs.roundPlayer.round && hs.roundPlayer.round.status;
    if (st && st !== 'closed') return;
    const uid = hs.roundPlayer.user && hs.roundPlayer.user.id;
    if (!uid) return;
    if (!map[uid]) map[uid] = emptyStats();
    const k = classify(hs.score, hs.par);
    map[uid].holes += 1;
    if (k) map[uid][k] += 1;
  });
  return map;
}

function cardJson(u, stats) {
  const s = stats || emptyStats();
  return {
    id: u.id,
    first_name: u.first_name,
    last_name: u.last_name,
    index_value: u.index_value,
    is_rookie: u.is_rookie,
    club: u.club ? { id: u.club.id, code: u.club.code, short_name: u.club.short_name || u.club.code } : { id: null, code: 'NONE', short_name: 'Sans club' },
    nickname: u.card_nickname || null,
    bio: u.card_bio || null,
    photo_url: u.card_photo || null,
    stats: s,
    badge: badge(u, s),
  };
}

async function listAlbum(req, res) {
  try {
    const club = String(req.query.club || 'all');
    const users = await User.findAll({
      where: { is_active: true },
      include: [{ model: Club, as: 'club', required: false }],
      attributes: { exclude: ['password_hash'] },
      order: [['last_name', 'ASC'], ['first_name', 'ASC']],
    });
    const stats = await statsByUser();
    let cards = users.map((u) => cardJson(u, stats[u.id]));
    if (club && club !== 'all') cards = cards.filter((c) => String(c.club.code || 'NONE') === club);
    cards.sort((a, b) => Number(a.index_value) - Number(b.index_value));
    res.json({ cards });
  } catch (err) {
    console.error('listAlbum', err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}

async function updateMyCard(req, res) {
  try {
    const targetId = req.params.id && req.params.id !== 'me' ? req.params.id : req.user.id;
    const isSelf = targetId === req.user.id;
    const isPlatine = ['platine_admin', 'super_admin'].includes(req.user.role);
    if (!isSelf && !isPlatine) return res.status(403).json({ error: 'Tu ne peux modifier que ta fiche' });
    const user = await User.findByPk(targetId);
    if (!user) return res.status(404).json({ error: 'Joueur introuvable' });
    const data = {};
    if (req.body.nickname != null) data.card_nickname = String(req.body.nickname).slice(0, 40);
    if (req.body.bio != null) data.card_bio = String(req.body.bio).slice(0, 280);
    if (req.body.photo_url !== undefined) data.card_photo = req.body.photo_url || null;
    await user.update(data);
    const fresh = await User.findByPk(user.id, { include: [{ model: Club, as: 'club', required: false }] });
    const stats = await statsByUser();
    res.json({ card: cardJson(fresh, stats[fresh.id]), message: 'Fiche mise a jour' });
  } catch (err) {
    console.error('updateMyCard', err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}

module.exports = { listAlbum, updateMyCard };
