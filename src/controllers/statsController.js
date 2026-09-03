const { HoleScore, RoundPlayer, Round, User, Club } = require('../models');
const { Op, fn, col, literal } = require('sequelize');

const KEYS = [
  'hio',
  'albatross',
  'eagle',
  'birdie',
  'par',
  'bogey',
  'double',
  'triple',
  'quad',
  'worse',
  'croix',
];

function emptyCounts() {
  const o = { holes: 0 };
  KEYS.forEach((k) => {
    o[k] = 0;
  });
  return o;
}

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
  if (d === 3) return 'triple';
  if (d === 4) return 'quad';
  return 'worse';
}

async function loadScores() {
  return HoleScore.findAll({
    include: [
      {
        model: RoundPlayer,
        as: 'roundPlayer',
        required: true,
        include: [
          {
            model: Round,
            as: 'round',
            required: true,
            attributes: ['id', 'status', 'type'],
          },
          {
            model: User,
            as: 'user',
            required: true,
            attributes: ['id', 'first_name', 'last_name', 'club_id'],
            include: [
              {
                model: Club,
                as: 'club',
                attributes: ['id', 'code', 'short_name', 'name'],
                required: false,
              },
            ],
          },
        ],
      },
    ],
    limit: 30000,
  });
}

async function getHoleStats(req, res) {
  try {
    const { user_id, scope = 'player', from, to } = req.query;
    const whereRound = {};
    if (from || to) {
      whereRound.date = {};
      if (from) whereRound.date[Op.gte] = from;
      if (to) whereRound.date[Op.lte] = to;
    }
    const whereRp = {};
    if (scope === 'player') {
      whereRp.user_id = user_id || req.user.id;
    }

    const rows = await HoleScore.findAll({
      attributes: [
        'hole_number',
        [fn('AVG', col('HoleScore.score')), 'avg_score'],
        [fn('AVG', col('HoleScore.par')), 'avg_par'],
        [fn('COUNT', col('HoleScore.id')), 'rounds_count'],
        [
          fn('SUM', literal('CASE WHEN `HoleScore`.`score` < `HoleScore`.`par` THEN 1 ELSE 0 END')),
          'birdies',
        ],
        [
          fn('SUM', literal('CASE WHEN `HoleScore`.`score` = `HoleScore`.`par` THEN 1 ELSE 0 END')),
          'pars',
        ],
        [
          fn('SUM', literal('CASE WHEN `HoleScore`.`score` = `HoleScore`.`par` + 1 THEN 1 ELSE 0 END')),
          'bogeys',
        ],
      ],
      include: [
        {
          model: RoundPlayer,
          as: 'roundPlayer',
          attributes: [],
          where: Object.keys(whereRp).length ? whereRp : undefined,
          required: true,
          include: [
            {
              model: Round,
              as: 'round',
              attributes: [],
              where: Object.keys(whereRound).length ? whereRound : undefined,
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
      const avgScore = r.avg_score != null ? Math.round(Number(r.avg_score) * 10) / 10 : null;
      const avgPar = r.avg_par != null ? Math.round(Number(r.avg_par) * 10) / 10 : null;
      return {
        hole: r.hole_number,
        rounds: Number(r.rounds_count) || 0,
        avg_score: avgScore,
        vs_par: avgScore != null && avgPar != null ? Math.round((avgScore - avgPar) * 10) / 10 : null,
        birdies: Number(r.birdies) || 0,
        pars: Number(r.pars) || 0,
        bogeys: Number(r.bogeys) || 0,
      };
    });
    const ranked = [...holes].filter((h) => h.vs_par != null).sort((a, b) => b.vs_par - a.vs_par);
    res.json({
      scope: scope === 'player' ? 'player' : 'general',
      holes,
      hardest: ranked[0] || null,
      easiest: ranked[ranked.length - 1] || null,
    });
  } catch (err) {
    console.error('getHoleStats', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function listStatPlayers(req, res) {
  try {
    const players = await RoundPlayer.findAll({
      attributes: ['user_id'],
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'first_name', 'last_name'],
          required: true,
        },
      ],
      group: ['user_id', 'user.id', 'user.first_name', 'user.last_name'],
      limit: 500,
    });
    res.json({
      players: players.map((p) => ({
        id: p.user_id,
        first_name: p.user?.first_name,
        last_name: p.user?.last_name,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function scoreboard(req, res) {
  try {
    const rows = await loadScores();
    const byClub = {};
    const byPlayer = {};

    for (const hs of rows) {
      const key = classify(hs.score, hs.par);
      if (!key) continue;
      const u = hs.roundPlayer?.user;
      if (!u) continue;
      const clubId = u.club_id || 'none';
      const clubName = u.club?.short_name || u.club?.code || 'Sans club';
      if (!byClub[clubId]) {
        byClub[clubId] = { club_id: clubId === 'none' ? null : clubId, name: clubName, ...emptyCounts() };
      }
      byClub[clubId][key] += 1;
      byClub[clubId].holes += 1;

      if (!byPlayer[u.id]) {
        byPlayer[u.id] = {
          user_id: u.id,
          name: `${u.last_name || ''} ${u.first_name || ''}`.trim(),
          club: clubName,
          ...emptyCounts(),
        };
      }
      byPlayer[u.id][key] += 1;
      byPlayer[u.id].holes += 1;
    }

    const sortFn = (a, b) =>
      b.hio - a.hio ||
      b.albatross - a.albatross ||
      b.eagle - a.eagle ||
      b.birdie - a.birdie ||
      a.croix - b.croix;

    res.json({
      clubs: Object.values(byClub).sort(sortFn),
      players: Object.values(byPlayer).sort(sortFn),
      keys: KEYS,
    });
  } catch (err) {
    console.error('scoreboard', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

module.exports = {
  getHoleStats,
  holes: getHoleStats,
  listStatPlayers,
  scoreboard,
};
