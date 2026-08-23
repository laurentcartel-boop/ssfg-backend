const { User, Club } = require('../models');
const { getIndexSeries, getCategories } = require('../services/indexService');
const { Op } = require('sequelize');

/**
 * GET /api/rankings
 * Classement général par index
 * Query: ?series=master|serie1|serie2  (optionnel)
 */
async function getIndexRanking(req, res) {
  try {
    const { series, club } = req.query;

    const users = await User.findAll({
      where: { is_active: true, role: { [Op.in]: ['joueur', 'admin', 'super_admin'] } },
      attributes: ['id', 'first_name', 'last_name', 'index_value', 'gender', 'birth_date', 'is_rookie', 'last_round_date', 'club_id'],
      include: [{ model: Club, as: 'club', attributes: ['id', 'code', 'short_name', 'name'], required: false }],
      order: [['index_value', 'ASC']], // plus bas = meilleur
    });

    let ranked = users.map((u, i) => ({
      rank: i + 1,
      id: u.id,
      first_name: u.first_name,
      last_name: u.last_name,
      index_value: Number(u.index_value),
      series: getIndexSeries(u.index_value),
      categories: getCategories(u),
      last_round_date: u.last_round_date,
      club: u.club
        ? { id: u.club.id, code: u.club.code, short_name: u.club.short_name, name: u.club.name }
        : null,
    }));

    if (club) {
      const code = String(club).toUpperCase();
      ranked = ranked.filter((r) => (r.club?.code || '').toUpperCase() === code);
    }

    // Filtrer par série si demandé
    if (series === 'master') {
      ranked = ranked.filter((r) => r.series === 'master');
    } else if (series === 'serie1') {
      ranked = ranked.filter((r) => r.series === 'serie1');
    } else if (series === 'serie2') {
      ranked = ranked.filter((r) => r.series === 'serie2');
    }

    // Recalculer le rang dans la série filtrée
    if (series) {
      ranked = ranked.map((r, i) => ({ ...r, rank: i + 1 }));
    }

    res.json({
      series: series || 'all',
      total: ranked.length,
      ranking: ranked,
    });
  } catch (err) {
    console.error('getIndexRanking error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * GET /api/rankings/categories/:category
 * Classement par catégorie (juniors, mens, seniors, veterans, feminines, rookies)
 */
async function getCategoryRanking(req, res) {
  try {
    const category = req.params.category.toLowerCase();
    const valid = ['juniors', 'mens', 'seniors', 'veterans', 'feminines', 'rookies'];

    if (!valid.includes(category)) {
      return res.status(400).json({
        error: `Catégorie invalide. Valeurs possibles: ${valid.join(', ')}`,
      });
    }

    const users = await User.findAll({
      where: { is_active: true },
      attributes: ['id', 'first_name', 'last_name', 'index_value', 'gender', 'birth_date', 'is_rookie', 'last_round_date', 'club_id'],
      include: [{ model: Club, as: 'club', attributes: ['id', 'code', 'short_name', 'name'], required: false }],
      order: [['index_value', 'ASC']],
    });

    const ranked = users
      .map((u) => ({
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        index_value: Number(u.index_value),
        series: getIndexSeries(u.index_value),
        categories: getCategories(u),
        last_round_date: u.last_round_date,
      }))
      .filter((r) => r.categories.includes(category))
      .map((r, i) => ({ ...r, rank: i + 1 }));

    res.json({
      category,
      total: ranked.length,
      ranking: ranked,
    });
  } catch (err) {
    console.error('getCategoryRanking error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * GET /api/rankings/top
 * Top 20 global (comme sur self-index.info)
 */
async function getTop20(req, res) {
  try {
    const users = await User.findAll({
      where: { is_active: true },
      attributes: ['id', 'first_name', 'last_name', 'index_value'],
      order: [['index_value', 'ASC']],
      limit: 20,
    });

    const ranking = users.map((u, i) => ({
      rank: i + 1,
      id: u.id,
      first_name: u.first_name,
      last_name: u.last_name,
      index_value: Number(u.index_value),
      series: getIndexSeries(u.index_value),
    }));

    res.json({ ranking });
  } catch (err) {
    console.error('getTop20 error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}


/**
 * GET /api/rankings/season/:year
 * Classement saison par POINTS (compétitions clôturées, score BRUT)
 * Place 1 = 150 pts, 2 = 145, ... minimum 5 pts pour tous les classés.
 * Query: ?category=seniors|veterans|mens|...  (optionnel)
 */
function pointsForPlace(place) {
  // place 1-based
  return Math.max(5, 150 - (place - 1) * 5);
}

async function getSeasonRanking(req, res) {
  try {
    const year = parseInt(req.params.year, 10);
    if (!year || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'Année invalide' });
    }
    const { category } = req.query;

    const {
      Round,
      RoundPlayer,
      User,
      Competition,
    } = require('../models');

    // Rounds compétition clôturés de l'année
    const rounds = await Round.findAll({
      where: {
        type: 'competition',
        status: 'closed',
        date: {
          [Op.gte]: `${year}-01-01`,
          [Op.lte]: `${year}-12-31`,
        },
      },
      include: [
        {
          model: RoundPlayer,
          as: 'players',
          include: [
            {
              model: User,
              as: 'user',
              attributes: [
                'id',
                'first_name',
                'last_name',
                'index_value',
                'gender',
                'birth_date',
                'is_rookie',
                'is_active',
              ],
            },
          ],
        },
      ],
    });

    // Grouper par compétition (ou par round si pas de competition_id)
    const events = new Map();
    for (const round of rounds) {
      const key = round.competition_id || `round:${round.id}`;
      if (!events.has(key)) events.set(key, []);
      for (const rp of round.players || []) {
        if (!rp.user || !rp.user.is_active) continue;
        if (rp.total_score == null) continue;
        events.get(key).push({
          user_id: rp.user_id,
          user: rp.user,
          brut: Number(rp.total_score),
        });
      }
    }

    // Points cumulés par joueur
    const byUser = new Map();

    for (const [, entries] of events) {
      // Un seul score par joueur et par événement (meilleur brut si doublon)
      const bestByUser = new Map();
      for (const e of entries) {
        const prev = bestByUser.get(e.user_id);
        if (!prev || e.brut < prev.brut) bestByUser.set(e.user_id, e);
      }
      const list = Array.from(bestByUser.values());
      // Classement brut : score le plus bas gagne
      list.sort((a, b) => a.brut - b.brut);

      list.forEach((e, idx) => {
        const place = idx + 1;
        const pts = pointsForPlace(place);
        if (!byUser.has(e.user_id)) {
          byUser.set(e.user_id, {
            id: e.user_id,
            first_name: e.user.first_name,
            last_name: e.user.last_name,
            index_value: Number(e.user.index_value),
            series: getIndexSeries(e.user.index_value),
            categories: getCategories(e.user),
            competitions_played: 0,
            points: 0,
            results: [],
          });
        }
        const row = byUser.get(e.user_id);
        row.competitions_played += 1;
        row.points += pts;
        row.results.push({ place, points: pts, brut: e.brut });
      });
    }

    let ranking = Array.from(byUser.values());

    if (category) {
      ranking = ranking.filter((r) => r.categories.includes(category));
    }

    ranking.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (a.competitions_played !== b.competitions_played) {
        return b.competitions_played - a.competitions_played;
      }
      return a.last_name.localeCompare(b.last_name, 'fr');
    });

    ranking = ranking.map((r, i) => ({
      rank: i + 1,
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      index_value: r.index_value,
      series: r.series,
      categories: r.categories,
      competitions_played: r.competitions_played,
      points: r.points,
    }));

    res.json({
      year,
      mode: 'points',
      sort: 'brut',
      category: category || null,
      total: ranking.length,
      ranking,
      rules: {
        first: 150,
        step: -5,
        minimum: 5,
        description:
          '1er = 150 pts, 2e = 145, ... minimum 5 pts. Classement par score brut de chaque compétition.',
      },
    });
  } catch (err) {
    console.error('getSeasonRanking error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * GET /api/rankings/season-years
 * Années disponibles (présentes dans les compétitions)
 */
async function getSeasonYears(req, res) {
  try {
    const { Competition, Round, sequelize } = require('../models');
    const { QueryTypes } = require('sequelize');
    const years = new Set();
    years.add(new Date().getFullYear());

    const comps = await Competition.findAll({ attributes: ['date'] });
    comps.forEach((c) => {
      if (c.date) years.add(new Date(c.date).getFullYear());
    });
    const rounds = await Round.findAll({
      where: { type: 'competition' },
      attributes: ['date'],
    });
    rounds.forEach((r) => {
      if (r.date) years.add(new Date(r.date).getFullYear());
    });

    const list = Array.from(years).filter((y) => y >= 2020).sort((a, b) => b - a);
    res.json({ years: list, current: new Date().getFullYear() });
  } catch (err) {
    console.error('getSeasonYears error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

module.exports = {
  getIndexRanking,
  getCategoryRanking,
  getTop20,
  getSeasonRanking,
  getSeasonYears,
};
