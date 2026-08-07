const { User } = require('../models');
const { getIndexSeries, getCategories } = require('../services/indexService');
const { Op } = require('sequelize');

/**
 * GET /api/rankings
 * Classement général par index
 * Query: ?series=master|serie1|serie2  (optionnel)
 */
async function getIndexRanking(req, res) {
  try {
    const { series } = req.query;

    const users = await User.findAll({
      where: { is_active: true, role: { [Op.in]: ['joueur', 'admin', 'super_admin'] } },
      attributes: ['id', 'first_name', 'last_name', 'index_value', 'gender', 'birth_date', 'is_rookie', 'last_round_date'],
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
    }));

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
      attributes: ['id', 'first_name', 'last_name', 'index_value', 'gender', 'birth_date', 'is_rookie', 'last_round_date'],
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
 * Classement saison (compétitions clôturées uniquement)
 * Query: ?sort=brut|net  &series=master|serie1|serie2  &category=mens|...
 */
async function getSeasonRanking(req, res) {
  try {
    const year = parseInt(req.params.year, 10);
    if (!year || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'Année invalide' });
    }
    const sort = req.query.sort === 'net' ? 'net' : 'brut';
    const { series, category } = req.query;

    const {
      Round,
      RoundPlayer,
      Course,
      User,
      Competition,
    } = require('../models');

    // Parties de type competition, clôturées, dans l'année
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
        { model: Course, as: 'course', attributes: ['par_total'] },
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

    // Agrégation par joueur : somme des scores, nb compétitions, meilleur brut/net
    const byUser = new Map();

    for (const round of rounds) {
      const par = round.course?.par_total || 72;
      for (const rp of round.players || []) {
        if (!rp.user || !rp.user.is_active) continue;
        if (rp.total_score == null) continue;

        const uid = rp.user_id;
        if (!byUser.has(uid)) {
          byUser.set(uid, {
            id: uid,
            first_name: rp.user.first_name,
            last_name: rp.user.last_name,
            index_value: Number(rp.user.index_value),
            series: getIndexSeries(rp.user.index_value),
            categories: getCategories(rp.user),
            competitions_played: 0,
            total_brut: 0,
            total_net: 0,
            best_brut: null,
            best_net: null,
          });
        }
        const row = byUser.get(uid);
        const brut = Number(rp.total_score);
        const net = Number(rp.net_score != null ? rp.net_score : brut - Number(rp.starting_index || 0));
        row.competitions_played += 1;
        row.total_brut += brut;
        row.total_net += net;
        if (row.best_brut === null || brut < row.best_brut) row.best_brut = brut;
        if (row.best_net === null || net < row.best_net) row.best_net = net;
      }
    }

    let ranking = Array.from(byUser.values());

    if (series === 'master') ranking = ranking.filter((r) => r.series === 'master');
    else if (series === 'serie1') ranking = ranking.filter((r) => r.series === 'serie1');
    else if (series === 'serie2') ranking = ranking.filter((r) => r.series === 'serie2');

    if (category) {
      ranking = ranking.filter((r) => r.categories.includes(category));
    }

    // Tri : meilleur score (plus bas = mieux) sur la somme, puis best
    ranking.sort((a, b) => {
      if (sort === 'net') {
        if (a.total_net !== b.total_net) return a.total_net - b.total_net;
        return (a.best_net ?? 999) - (b.best_net ?? 999);
      }
      if (a.total_brut !== b.total_brut) return a.total_brut - b.total_brut;
      return (a.best_brut ?? 999) - (b.best_brut ?? 999);
    });

    ranking = ranking.map((r, i) => ({ ...r, rank: i + 1 }));

    res.json({
      year,
      sort,
      series: series || 'all',
      category: category || null,
      total: ranking.length,
      ranking,
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
