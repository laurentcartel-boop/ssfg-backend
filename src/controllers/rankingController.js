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

module.exports = {
  getIndexRanking,
  getCategoryRanking,
  getTop20,
};
