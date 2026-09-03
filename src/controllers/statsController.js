const {
  HoleScore,
  RoundPlayer,
  Round,
  User,
  sequelize,
} = require('../models');
const { Op, fn, col, literal } = require('sequelize');

/**
 * GET /api/stats/holes
 * Statistiques de trous (score moyen, vs par, birdies/pars/bogeys)
 * Query:
 *   - user_id (optionnel) : stats d'un joueur
 *   - scope=player|general (défaut player)
 *   - from, to (dates optionnelles, YYYY-MM-DD)
 */
async function getHoleStats(req, res) {
  try {
    const { user_id, scope = 'player', from, to } = req.query;

    const whereRound = { status: 'closed' };
    if (from || to) {
      whereRound.date = {};
      if (from) whereRound.date[Op.gte] = from;
      if (to) whereRound.date[Op.lte] = to;
    }

    const whereRp = {};
    if (scope === 'player') {
      const targetUserId = user_id || req.user.id;
      whereRp.user_id = targetUserId;
    }

    const rows = await HoleScore.findAll({
      attributes: [
        'hole_number',
        [fn('AVG', col('HoleScore.score')), 'avg_score'],
        [fn('AVG', col('HoleScore.par')), 'avg_par'],
        [fn('COUNT', col('HoleScore.id')), 'rounds_count'],
        [fn('SUM', literal('CASE WHEN `HoleScore`.`score` < `HoleScore`.`par` THEN 1 ELSE 0 END')), 'birdies'],
        [fn('SUM', literal('CASE WHEN `HoleScore`.`score` = `HoleScore`.`par` THEN 1 ELSE 0 END')), 'pars'],
        [fn('SUM', literal('CASE WHEN `HoleScore`.`score` = `HoleScore`.`par` + 1 THEN 1 ELSE 0 END')), 'bogeys'],
        [fn('SUM', literal('CASE WHEN `HoleScore`.`score` > `HoleScore`.`par` + 1 THEN 1 ELSE 0 END')), 'worse'],
        [fn('MIN', col('HoleScore.score')), 'best'],
        [fn('MAX', col('HoleScore.score')), 'worst'],
      ],
      include: [
        {
          model: RoundPlayer,
          as: 'roundPlayer',
          attributes: [],
          where: whereRp,
          required: true,
          include: [
            {
              model: Round,
              as: 'round',
              attributes: [],
              where: whereRound,
              required: true,
            },
          ],
        },
      ],
      group: ['hole_number'],
      order: [['hole_number', 'ASC']],
      raw: true,
    });

    const holes = rows.map((r) => {
      const avgScore = r.avg_score != null ? Math.round(Number(r.avg_score) * 100) / 100 : null;
      const avgPar = r.avg_par != null ? Math.round(Number(r.avg_par) * 100) / 100 : null;
      const vsPar = avgScore != null && avgPar != null ? Math.round((avgScore - avgPar) * 100) / 100 : null;
      const rounds = Number(r.rounds_count) || 0;
      const birdies = Number(r.birdies) || 0;
      const pars = Number(r.pars) || 0;
      const bogeys = Number(r.bogeys) || 0;
      const worse = Number(r.worse) || 0;
      const scored = birdies + pars + bogeys + worse;
      return {
        hole: r.hole_number,
        rounds,
        avg_score: avgScore,
        avg_par: avgPar,
        vs_par: vsPar,
        best: r.best != null ? Number(r.best) : null,
        worst: r.worst != null ? Number(r.worst) : null,
        birdies,
        pars,
        bogeys,
        worse,
        birdie_rate: scored ? Math.round((birdies / scored) * 100) : 0,
        par_rate: scored ? Math.round((pars / scored) * 100) : 0,
        bogey_rate: scored ? Math.round((bogeys / scored) * 100) : 0,
      };
    });

    // Trou le plus dur / le plus facile (par vs_par moyen)
    const ranked = [...holes].filter((h) => h.vs_par != null).sort((a, b) => b.vs_par - a.vs_par);
    const hardest = ranked[0] || null;
    const easiest = ranked[ranked.length - 1] || null;

    res.json({
      scope: scope === 'player' ? 'player' : 'general',
      user_id: scope === 'player' ? user_id || req.user.id : null,
      from: from || null,
      to: to || null,
      holes,
      hardest,
      easiest,
      total_rounds: holes.reduce((s, h) => Math.max(s, h.rounds), 0),
    });
  } catch (err) {
    console.error('getHoleStats error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * GET /api/stats/players
 * Liste des joueurs ayant des stats (pour le sélecteur)
 */
async function listStatPlayers(req, res) {
  try {
    const players = await RoundPlayer.findAll({
      attributes: ['user_id'],
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'first_name', 'last_name'],
          where: { is_active: true },
          required: true,
        },
        {
          model: HoleScore,
          as: 'holeScores',
          attributes: [],
          required: true,
        },
      ],
      group: ['user_id', 'user.id', 'user.first_name', 'user.last_name'],
      order: [['user', 'last_name', 'ASC']],
    });

    res.json({
      players: players.map((p) => ({
        id: p.user_id,
        first_name: p.user.first_name,
        last_name: p.user.last_name,
      })),
    });
  } catch (err) {
    console.error('listStatPlayers error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

module.exports = {
  getHoleStats,
  listStatPlayers,
};
