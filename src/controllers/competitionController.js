const {
  Competition,
  Round,
  RoundPlayer,
  HoleScore,
  Course,
  User,
  Club,
  sequelize,
} = require('../models');
const { calculateIndexChange } = require('../services/indexService');

function formatPlayer(row) {
  if (!row) return null;
  const tp = row.to_par;
  const brut =
    tp == null ? '—' : tp === 0 ? 'E' : tp > 0 ? `+${tp}` : String(tp);
  const net =
    row.net_to_par == null ? '—' : Number(row.net_to_par).toFixed(1);
  return {
    user_id: row.user_id,
    name: `${row.last_name || ''} ${row.first_name || ''}`.trim(),
    brut,
    net,
    strokes: row.total_strokes,
    series: row.series,
  };
}

function pickBest(rows, field) {
  const ready = rows.filter((r) => r[field] != null && r.holes_played >= 18);
  ready.sort((a, b) => a[field] - b[field]);
  return ready[0] || null;
}

function buildPalmares(leaderboard, competition) {
  const finished = (leaderboard || []).filter((r) => r.holes_played >= 18);
  const prizes = [];

  const bestBrut = pickBest(finished, 'to_par');
  prizes.push({
    key: 'brut',
    label: 'Meilleur brut',
    player: formatPlayer(bestBrut),
  });

  const bestNet = pickBest(finished, 'net_to_par');
  prizes.push({
    key: 'net',
    label: 'Meilleur net',
    player: formatPlayer(bestNet),
  });

  const skipId = bestBrut?.user_id;
  const seriesMeta = [
    ['master', 'Meilleur brut Master'],
    ['serie1', 'Meilleur brut Série 1'],
    ['serie2', 'Meilleur brut Série 2'],
  ];
  for (const [key, label] of seriesMeta) {
    const pool = finished.filter((r) => r.series === key && r.user_id !== skipId);
    const winner = pickBest(pool, 'to_par');
    prizes.push({
      key,
      label,
      player: formatPlayer(winner),
      note:
        bestBrut && bestBrut.series === key
          ? 'Le vainqueur brut général est déjà dans cette série — prix au suivant'
          : null,
    });
  }

  for (const [cat, label] of [
    ['seniors', 'Meilleur sénior'],
    ['veterans', 'Meilleur vétéran'],
  ]) {
    const pool = finished.filter((r) => (r.categories || []).includes(cat));
    prizes.push({
      key: cat,
      label,
      player: formatPlayer(pickBest(pool, 'to_par')),
    });
  }

  const rookies = finished.filter((r) => (r.categories || []).includes('rookies'));
  prizes.push({
    key: 'rookies',
    label: 'Meilleur rookie',
    player: formatPlayer(pickBest(rookies, 'to_par')),
  });

  const hios = [];
  for (const squad of competition.squads || []) {
    for (const e of squad.exploits || []) {
      if (e.exploit_type === 'hole_in_one') {
        const row = leaderboard.find((r) => r.user_id === e.user_id);
        hios.push({
          hole: e.hole_number,
          name: row
            ? `${row.last_name || ''} ${row.first_name || ''}`.trim()
            : e.user_id,
        });
      }
    }
  }
  prizes.push({
    key: 'hio',
    label: 'Hole in one',
    player: null,
    hios,
  });

  return {
    ready: finished.length > 0,
    prizes,
  };
}



/**
 * GET /api/competitions
 */
async function listCompetitions(req, res) {
  try {
    const { status, year, limit = 50, scope_type, club_id } = req.query;
    const where = {};
    if (status) where.status = status;
    if (scope_type) where.scope_type = scope_type;
    if (club_id) where.club_id = club_id;
    if (year) {
      const y = parseInt(year, 10);
      if (!Number.isNaN(y)) {
        where.date = {
          [require('sequelize').Op.gte]: `${y}-01-01`,
          [require('sequelize').Op.lte]: `${y}-12-31`,
        };
      }
    }

    const competitions = await Competition.findAll({
      where,
      include: [
        { model: Course, as: 'course', attributes: ['id', 'name', 'short_name', 'par_total'] },
        { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name'] },
        {
          model: Club,
          as: 'club',
          attributes: ['id', 'code', 'short_name', 'name'],
          required: false,
        },
        {
          model: Round,
          as: 'squads',
          attributes: ['id', 'name', 'status'],
        },
      ],
      order: [['date', 'DESC'], ['created_at', 'DESC']],
      limit: Math.min(parseInt(limit, 10) || 50, 100),
    });

    res.json({ competitions });
  } catch (err) {
    console.error('listCompetitions error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * GET /api/competitions/:id
 * Détail + classement live de tous les squads
 */
async function getCompetition(req, res) {
  try {
    const competition = await Competition.findByPk(req.params.id, {
      include: [
        { model: Course, as: 'course' },
        { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name'] },
        {
          model: Round,
          as: 'squads',
          include: [
            {
              model: require('../models').RoundExploit,
              as: 'exploits',
              required: false,
            },
            {
              model: RoundPlayer,
              as: 'players',
              include: [
                {
                  model: User,
                  as: 'user',
                  attributes: ['id', 'first_name', 'last_name', 'index_value', 'gender', 'club_id', 'birth_date', 'is_rookie'],
                  include: [
                    {
                      model: require('../models').Club,
                      as: 'club',
                      attributes: ['id', 'code', 'short_name'],
                      required: false,
                    },
                  ],
                },
                { model: HoleScore, as: 'holeScores' },
              ],
            },
          ],
        },
      ],
      order: [[{ model: Round, as: 'squads' }, 'created_at', 'ASC']],
    });

    if (!competition) {
      return res.status(404).json({ error: 'Compétition non trouvée' });
    }

    const holesData = competition.course?.holes_data || [];
    const parByHole = {};
    holesData.forEach((h) => {
      parByHole[h.hole] = Number(h.par) || 4;
    });
    const parTotal = competition.course?.par_total || 72;
    const leaderboard = [];

    for (const squad of competition.squads || []) {
      for (const rp of squad.players || []) {
        const scores = rp.holeScores || [];
        const holesPlayed = scores.length;
        const totalStrokes = scores.reduce((s, h) => s + (h.strokes || 0), 0);
        let parPlayed = 0;
        scores.forEach((h) => {
          parPlayed += parByHole[h.hole_number] || 4;
        });
        const toPar = holesPlayed ? totalStrokes - parPlayed : null;
        const startingIndex = Number(rp.starting_index ?? rp.user?.index_value ?? 0);

        const { getIndexSeries, getCategories } = require('../services/indexService');
        leaderboard.push({
          user_id: rp.user_id,
          first_name: rp.user?.first_name,
          last_name: rp.user?.last_name,
          index_value: startingIndex,
          series: getIndexSeries(startingIndex),
          categories: getCategories(rp.user || {}),
          squad_id: squad.id,
          squad_name: squad.name,
          squad_status: squad.status,
          holes_played: holesPlayed,
          total_strokes: totalStrokes,
          to_par: toPar,
          net_to_par: toPar !== null ? toPar - startingIndex * (holesPlayed / 18) : null,
        });
      }
    }

    // Sort by holes played desc, then to_par asc (better), then strokes
    leaderboard.sort((a, b) => {
      if (b.holes_played !== a.holes_played) return b.holes_played - a.holes_played;
      if (a.to_par !== b.to_par) return (a.to_par ?? 99) - (b.to_par ?? 99);
      return a.total_strokes - b.total_strokes;
    });

    const palmares = buildPalmares(leaderboard, competition);
    const compJson = typeof competition.toJSON === 'function' ? competition.toJSON() : competition;
    res.json({
      competition: { ...compJson, leaderboard, palmares },
      leaderboard,
      palmares,
    });
  } catch (err) {
    console.error('getCompetition error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * POST /api/competitions
 * Admin+ : créer une compétition (sans squads au départ)
 * Body: { name, course_id, date }
 */
async function createCompetition(req, res) {
  try {
    const { name, course_id, date, scope_type = 'open', club_id = null } = req.body;
    if (!name || !course_id || !date) {
      return res.status(400).json({ error: 'name, course_id et date sont obligatoires' });
    }

    const scope = ['club', 'interclub', 'open'].includes(scope_type)
      ? scope_type
      : 'open';
    if (scope === 'club' && !club_id) {
      return res.status(400).json({ error: 'club_id obligatoire pour une compétition de club' });
    }

    const course = await Course.findByPk(course_id);
    if (!course) return res.status(404).json({ error: 'Parcours non trouvé' });

    const competition = await Competition.create({
      name: name.trim(),
      course_id,
      date,
      status: 'open',
      created_by: req.user.id,
      scope_type: scope,
      club_id: scope === 'club' ? club_id : null,
    });

    res.status(201).json({ competition, message: 'Compétition créée' });
  } catch (err) {
    console.error('createCompetition error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * POST /api/competitions/:id/squads
 * Admin+ : ajouter un squad (partie liée)
 * Body: { name, player_ids: [] }
 */
async function addSquad(req, res) {
  const t = await sequelize.transaction();
  try {
    const competition = await Competition.findByPk(req.params.id);
    if (!competition) {
      await t.rollback();
      return res.status(404).json({ error: 'Compétition non trouvée' });
    }
    if (competition.status === 'closed') {
      await t.rollback();
      return res.status(400).json({ error: 'Compétition déjà clôturée' });
    }

    const { name, player_ids = [] } = req.body;
    if (!name) {
      await t.rollback();
      return res.status(400).json({ error: 'Nom du squad obligatoire' });
    }
    if (player_ids.length < 2) {
      await t.rollback();
      return res.status(400).json({ error: 'Minimum 2 joueurs par squad' });
    }

    const round = await Round.create(
      {
        name: name.trim(),
        type: 'competition',
        course_id: competition.course_id,
        date: competition.date,
        // draft tant que la compétition n'est pas lancée → pas de live public
        status: competition.launched_at ? 'in_progress' : 'draft',
        created_by: req.user.id,
        competition_id: competition.id,
      },
      { transaction: t }
    );

    for (const userId of player_ids) {
      const user = await User.findByPk(userId);
      if (!user) continue;
      await RoundPlayer.create(
        {
          round_id: round.id,
          user_id: userId,
          starting_index: user.index_value,
        },
        { transaction: t }
      );
    }

    await t.commit();

    const full = await Round.findByPk(round.id, {
      include: [
        {
          model: RoundPlayer,
          as: 'players',
          include: [{ model: User, as: 'user', attributes: ['id', 'first_name', 'last_name', 'index_value'] }],
        },
      ],
    });

    res.status(201).json({ squad: full, message: 'Squad ajouté' });
  } catch (err) {
    await t.rollback();
    console.error('addSquad error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * POST /api/competitions/:id/close
 * Super-admin : clôturer la compétition
 * (ne recalcule pas l'index ici : chaque squad se clôture individuellement)
 */
async function closeCompetition(req, res) {
  try {
    const competition = await Competition.findByPk(req.params.id, {
      include: [{ model: Round, as: 'squads' }],
    });
    if (!competition) return res.status(404).json({ error: 'Compétition non trouvée' });

    const openSquads = (competition.squads || []).filter((s) => s.status !== 'closed');
    if (openSquads.length > 0) {
      return res.status(400).json({
        error: `${openSquads.length} squad(s) encore ouverts. Clôturez-les d'abord.`,
      });
    }

    await competition.update({
      status: 'closed',
      closed_by: req.user.id,
      closed_at: new Date(),
    });

    res.json({ competition, message: 'Compétition clôturée' });
  } catch (err) {
    console.error('closeCompetition error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}


async function deleteCompetition(req, res) {
  try {
    const { Competition, Round, RoundPlayer, HoleScore } = require('../models');
    const competition = await Competition.findByPk(req.params.id, {
      include: [{ model: Round, as: 'squads', include: [{ model: RoundPlayer, as: 'players', include: [{ model: HoleScore, as: 'holeScores' }] }] }],
    });
    if (!competition) return res.status(404).json({ error: 'Compétition non trouvée' });
    for (const squad of competition.squads || []) {
      for (const rp of squad.players || []) {
        await HoleScore.destroy({ where: { round_player_id: rp.id } });
      }
      await RoundPlayer.destroy({ where: { round_id: squad.id } });
      await squad.destroy();
    }
    await competition.destroy();
    res.json({ message: 'Compétition et squads supprimés' });
  } catch (err) {
    console.error('deleteCompetition', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}


/**
 * PATCH /api/competitions/:id/squads/:squadId
 * Modifier nom et/ou joueurs d'un squad (avant lancement)
 * Body: { name?, player_ids? }
 */
async function updateSquad(req, res) {
  const t = await sequelize.transaction();
  try {
    const competition = await Competition.findByPk(req.params.id);
    if (!competition) {
      await t.rollback();
      return res.status(404).json({ error: 'Compétition non trouvée' });
    }
    if (competition.status === 'closed') {
      await t.rollback();
      return res.status(400).json({ error: 'Compétition clôturée' });
    }
    if (competition.launched_at) {
      await t.rollback();
      return res.status(400).json({
        error: 'Compétition déjà lancée — débloquez-la ou ajustez avant lancement',
      });
    }

    const squad = await Round.findOne({
      where: { id: req.params.squadId, competition_id: competition.id },
      transaction: t,
    });
    if (!squad) {
      await t.rollback();
      return res.status(404).json({ error: 'Squad introuvable' });
    }
    if (squad.status === 'closed') {
      await t.rollback();
      return res.status(400).json({ error: 'Squad déjà clôturé' });
    }

    const { name, player_ids } = req.body;
    if (name != null && String(name).trim()) {
      await squad.update({ name: String(name).trim() }, { transaction: t });
    }

    if (Array.isArray(player_ids)) {
      if (player_ids.length < 2) {
        await t.rollback();
        return res.status(400).json({ error: 'Minimum 2 joueurs par squad' });
      }
      // Interdire si des scores existent
      const existing = await RoundPlayer.findAll({
        where: { round_id: squad.id },
        include: [{ model: HoleScore, as: 'holeScores' }],
        transaction: t,
      });
      const hasScores = existing.some((rp) => (rp.holeScores || []).length > 0);
      if (hasScores) {
        await t.rollback();
        return res.status(400).json({
          error: 'Des scores existent déjà sur ce squad — impossible de modifier la composition',
        });
      }
      await RoundPlayer.destroy({ where: { round_id: squad.id }, transaction: t });
      for (const userId of player_ids) {
        const user = await User.findByPk(userId, { transaction: t });
        if (!user) continue;
        await RoundPlayer.create(
          {
            round_id: squad.id,
            user_id: userId,
            starting_index: user.index_value,
          },
          { transaction: t }
        );
      }
    }

    await t.commit();
    const full = await Round.findByPk(squad.id, {
      include: [
        {
          model: RoundPlayer,
          as: 'players',
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'first_name', 'last_name', 'index_value'],
            },
          ],
        },
      ],
    });
    res.json({ squad: full, message: 'Squad mis à jour' });
  } catch (err) {
    await t.rollback();
    console.error('updateSquad', err);
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}

/**
 * DELETE /api/competitions/:id/squads/:squadId
 * Supprimer un squad (avant lancement, sans scores)
 */
async function deleteSquad(req, res) {
  const t = await sequelize.transaction();
  try {
    const competition = await Competition.findByPk(req.params.id);
    if (!competition) {
      await t.rollback();
      return res.status(404).json({ error: 'Compétition non trouvée' });
    }
    if (competition.launched_at) {
      await t.rollback();
      return res.status(400).json({ error: 'Compétition déjà lancée' });
    }
    const squad = await Round.findOne({
      where: { id: req.params.squadId, competition_id: competition.id },
      include: [
        {
          model: RoundPlayer,
          as: 'players',
          include: [{ model: HoleScore, as: 'holeScores' }],
        },
      ],
      transaction: t,
    });
    if (!squad) {
      await t.rollback();
      return res.status(404).json({ error: 'Squad introuvable' });
    }
    const hasScores = (squad.players || []).some(
      (rp) => (rp.holeScores || []).length > 0
    );
    if (hasScores) {
      await t.rollback();
      return res.status(400).json({ error: 'Squad avec scores — impossible de supprimer' });
    }
    for (const rp of squad.players || []) {
      await RoundPlayer.destroy({ where: { id: rp.id }, transaction: t });
    }
    await squad.destroy({ transaction: t });
    await t.commit();
    res.json({ message: 'Squad supprimé' });
  } catch (err) {
    await t.rollback();
    console.error('deleteSquad', err);
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}

/**
 * POST /api/competitions/:id/launch
 * Valider / lancer la compétition (fige la composition)
 * Body: { unlock?: true } pour super_admin annuler le lancement
 */
async function launchCompetition(req, res) {
  try {
    const competition = await Competition.findByPk(req.params.id, {
      include: [{ model: Round, as: 'squads' }],
    });
    if (!competition) return res.status(404).json({ error: 'Compétition non trouvée' });
    if (competition.status === 'closed') {
      return res.status(400).json({ error: 'Compétition clôturée' });
    }

    if (req.body && req.body.unlock) {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Super-admin uniquement' });
      }
      await competition.update({ launched_at: null });
      // Remet en draft les squads sans scores (ceux en cours sans score)
      const squads = await Round.findAll({
        where: { competition_id: competition.id, status: 'in_progress' },
        include: [
          {
            model: RoundPlayer,
            as: 'players',
            include: [{ model: HoleScore, as: 'holeScores' }],
          },
        ],
      });
      for (const s of squads) {
        const hasScores = (s.players || []).some(
          (rp) => (rp.holeScores || []).length > 0
        );
        if (!hasScores) {
          await s.update({ status: 'draft' });
        }
      }
      const refreshed = await Competition.findByPk(competition.id);
      return res.json({
        competition: refreshed,
        message: 'Lancement annulé — composition modifiable à nouveau',
      });
    }

    const squads = competition.squads || [];
    if (squads.length === 0) {
      return res.status(400).json({ error: 'Aucun squad — composez avant de lancer' });
    }
    await competition.update({ launched_at: new Date() });
    // Passe tous les squads draft → in_progress (live scoring)
    await Round.update(
      { status: 'in_progress' },
      {
        where: {
          competition_id: competition.id,
          status: 'draft',
        },
      }
    );
    const refreshed = await Competition.findByPk(competition.id);
    res.json({
      competition: refreshed,
      message: 'Compétition lancée — live scoring actif, composition figée',
    });
  } catch (err) {
    console.error('launchCompetition', err);
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}


/**
 * POST /api/competitions/:id/registrations
 * Body: { user_ids: [], arrival_time? }
 */
async function addRegistrations(req, res) {
  try {
    const { CompetitionRegistration, User } = require('../models');
    const competition = await Competition.findByPk(req.params.id);
    if (!competition) return res.status(404).json({ error: 'Compétition non trouvée' });
    if (competition.status === 'closed') {
      return res.status(400).json({ error: 'Compétition clôturée' });
    }
    if (competition.launched_at) {
      return res.status(400).json({ error: 'Compétition déjà lancée' });
    }
    const user_ids = req.body.user_ids || [];
    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ error: 'user_ids requis' });
    }
    let arrival = req.body.arrival_time || null;
    if (arrival) {
      const m = String(arrival).match(/^(\d{1,2}):(\d{2})/);
      arrival = m ? `${String(m[1]).padStart(2, '0')}:${m[2]}` : String(arrival).slice(0, 10);
    }
    let added = 0;
    for (const uid of user_ids) {
      const user = await User.findByPk(uid);
      if (!user) continue;
      const [, created] = await CompetitionRegistration.findOrCreate({
        where: { competition_id: competition.id, user_id: uid },
        defaults: {
          competition_id: competition.id,
          user_id: uid,
          arrival_time: arrival,
        },
      });
      if (created) added += 1;
      else if (arrival) {
        await CompetitionRegistration.update(
          { arrival_time: arrival },
          { where: { competition_id: competition.id, user_id: uid } }
        );
      }
    }
    req.params.id = competition.id;
    return listRegistrations(req, res);
  } catch (err) {
    console.error('addRegistrations', err);
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}

/**
 * DELETE /api/competitions/:id/registrations/:userId
 */
async function removeRegistration(req, res) {
  try {
    const { CompetitionRegistration } = require('../models');
    const competition = await Competition.findByPk(req.params.id);
    if (!competition) return res.status(404).json({ error: 'Compétition non trouvée' });
    if (competition.launched_at) {
      return res.status(400).json({ error: 'Compétition déjà lancée' });
    }
    await CompetitionRegistration.destroy({
      where: {
        competition_id: competition.id,
        user_id: req.params.userId,
      },
    });
    return listRegistrations(req, res);
  } catch (err) {
    console.error('removeRegistration', err);
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}

module.exports = {
  listCompetitions,
  getCompetition,
  createCompetition,
  addSquad,
  updateSquad,
  deleteSquad,
  launchCompetition,
  closeCompetition,
  deleteCompetition,
  listRegistrations,
  addRegistrations,
  removeRegistration,
  setForcedGroups,
  composeSquads,
};

function timeToMinutes(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * GET /api/competitions/:id/registrations
 */
async function listRegistrations(req, res) {
  try {
    const { CompetitionRegistration, User, Club } = require('../models');
    const regs = await CompetitionRegistration.findAll({
      where: { competition_id: req.params.id },
      include: [
        {
          model: User,
          as: 'user',
          attributes: [
            'id',
            'first_name',
            'last_name',
            'index_value',
            'club_id',
            'email',
          ],
          include: [
            {
              model: Club,
              as: 'club',
              attributes: ['id', 'code', 'short_name'],
              required: false,
            },
          ],
        },
      ],
      order: [
        ['arrival_time', 'ASC'],
        ['created_at', 'ASC'],
      ],
    });

    // Joueurs déjà dans un squad
    const competition = await Competition.findByPk(req.params.id, {
      include: [
        {
          model: Round,
          as: 'squads',
          include: [{ model: RoundPlayer, as: 'players' }],
        },
      ],
    });
    const assigned = new Set();
    for (const s of competition?.squads || []) {
      for (const p of s.players || []) assigned.add(p.user_id);
    }

    res.json({
      registrations: regs.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        arrival_time: r.arrival_time,
        ticket: r.ticket,
        forced_group: r.forced_group,
        notes: r.notes,
        assigned: assigned.has(r.user_id),
        user: r.user
          ? {
              id: r.user.id,
              first_name: r.user.first_name,
              last_name: r.user.last_name,
              index_value: r.user.index_value,
              club: r.user.club
                ? {
                    code: r.user.club.code,
                    short_name: r.user.club.short_name,
                  }
                : null,
            }
          : null,
      })),
    });
  } catch (err) {
    console.error('listRegistrations', err);
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}

/**
 * PATCH registrations forced groups
 * Body: { groups: [ { label: 'A', user_ids: [] } ] } or { user_id, forced_group }
 */
async function setForcedGroups(req, res) {
  try {
    const { CompetitionRegistration } = require('../models');
    const competitionId = req.params.id;
    const competition = await Competition.findByPk(competitionId);
    if (!competition) return res.status(404).json({ error: 'Compétition non trouvée' });
    if (competition.status === 'closed') {
      return res.status(400).json({ error: 'Compétition clôturée' });
    }

    if (Array.isArray(req.body.groups)) {
      // reset all forced groups for this competition first for listed users
      for (const g of req.body.groups) {
        const label = String(g.label || g.forced_group || '').trim() || null;
        const ids = g.user_ids || [];
        for (const uid of ids) {
          await CompetitionRegistration.update(
            { forced_group: label },
            { where: { competition_id: competitionId, user_id: uid } }
          );
        }
      }
    } else if (req.body.user_id) {
      await CompetitionRegistration.update(
        { forced_group: req.body.forced_group || null },
        {
          where: {
            competition_id: competitionId,
            user_id: req.body.user_id,
          },
        }
      );
    } else if (req.body.clear_all) {
      await CompetitionRegistration.update(
        { forced_group: null },
        { where: { competition_id: competitionId } }
      );
    } else {
      return res.status(400).json({ error: 'groups ou user_id requis' });
    }

    return listRegistrations(req, res);
  } catch (err) {
    console.error('setForcedGroups', err);
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}

/**
 * POST /api/competitions/:id/compose-squads
 * Body: {
 *   interval_minutes?: 5,
 *   squad_size?: 3,
 *   arrival_tolerance?: 20,
 *   max_same_club?: 2,
 *   create_forced?: true  // crée d'abord les groupes forcés en squads
 * }
 */
async function composeSquads(req, res) {
  const t = await sequelize.transaction();
  try {
    const { CompetitionRegistration, User, Club } = require('../models');
    const competitionId = req.params.id;
    const competition = await Competition.findByPk(competitionId);
    if (!competition) {
      await t.rollback();
      return res.status(404).json({ error: 'Compétition non trouvée' });
    }
    if (competition.status === 'closed') {
      await t.rollback();
      return res.status(400).json({ error: 'Compétition clôturée' });
    }

    // squads de 3 max (préférence et plafond)
    const squadSize = Number(req.body.squad_size) || 3;
    const maxSquadSize = Math.min(Number(req.body.max_squad_size) || 3, 3);
    const tolerance = Number(req.body.arrival_tolerance) || 20;
    const maxSameClub = Number(req.body.max_same_club) || 2;
    const interval = Number(req.body.interval_minutes) || 5;
    const createForced = req.body.create_forced !== false;

    const regs = await CompetitionRegistration.findAll({
      where: { competition_id: competitionId },
      include: [
        {
          model: User,
          as: 'user',
          include: [{ model: Club, as: 'club', required: false }],
        },
      ],
      transaction: t,
    });

    // Already in a squad?
    const existingSquads = await Round.findAll({
      where: { competition_id: competitionId },
      include: [{ model: RoundPlayer, as: 'players' }],
      transaction: t,
    });
    const assigned = new Set();
    for (const s of existingSquads) {
      for (const p of s.players || []) assigned.add(p.user_id);
    }

    const pool = regs
      .filter((r) => r.user && !assigned.has(r.user_id))
      .map((r) => ({
        user_id: r.user_id,
        arrival: r.arrival_time,
        arrivalMin: timeToMinutes(r.arrival_time),
        club: r.user.club?.code || r.user.club?.short_name || 'NONE',
        forced_group: r.forced_group || null,
        name: `${r.user.last_name} ${r.user.first_name}`,
        index_value: r.user.index_value,
      }));

    const createdSquads = [];

    async function createSquadRound(name, playerIds, startLabel) {
      const round = await Round.create(
        {
          name: name.trim(),
          type: 'competition',
          course_id: competition.course_id,
          date: competition.date,
          status: competition.launched_at ? 'in_progress' : 'draft',
          created_by: req.user.id,
          competition_id: competition.id,
        },
        { transaction: t }
      );
      for (const userId of playerIds) {
        const user = await User.findByPk(userId, { transaction: t });
        if (!user) continue;
        await RoundPlayer.create(
          {
            round_id: round.id,
            user_id: userId,
            starting_index: user.index_value,
          },
          { transaction: t }
        );
        assigned.add(userId);
      }
      createdSquads.push({
        id: round.id,
        name: round.name,
        start: startLabel,
        player_ids: playerIds,
      });
      return round;
    }

    // 1) Groupes forcés → squads de 3 (compléter si 2 avec un 3e compatible)
    if (createForced) {
      const byGroup = new Map();
      for (const p of pool) {
        if (!p.forced_group) continue;
        if (assigned.has(p.user_id)) continue;
        if (!byGroup.has(p.forced_group)) byGroup.set(p.forced_group, []);
        byGroup.get(p.forced_group).push(p);
      }
      for (const [label, members] of byGroup) {
        if (members.length < 2) continue;
        // Découper par paquets de 3 si groupe forcé plus grand
        for (let i = 0; i < members.length; i += squadSize) {
          let chunk = members.slice(i, i + squadSize);
          if (chunk.length < 2) break;

          // Si 2 joueurs forcés : ajouter un 3e compatible (horaire ±, max même club)
          if (chunk.length === 2) {
            const free = pool.filter((p) => !assigned.has(p.user_id) && !p.forced_group);
            const times0 = chunk.map((m) => m.arrivalMin).filter((x) => x != null);
            const seedMin = times0.length ? Math.min(...times0) : null;
            const clubCount = {};
            for (const m of chunk) {
              const c = m.club || 'NONE';
              clubCount[c] = (clubCount[c] || 0) + 1;
            }
            free.sort((a, b) => {
              const da =
                seedMin != null && a.arrivalMin != null
                  ? Math.abs(a.arrivalMin - seedMin)
                  : 999;
              const db =
                seedMin != null && b.arrivalMin != null
                  ? Math.abs(b.arrivalMin - seedMin)
                  : 999;
              return da - db;
            });
            for (const cand of free) {
              if (seedMin != null && cand.arrivalMin != null) {
                if (Math.abs(cand.arrivalMin - seedMin) > tolerance) continue;
              }
              const c = cand.club || 'NONE';
              if ((clubCount[c] || 0) >= maxSameClub) continue;
              chunk = [...chunk, cand];
              break;
            }
            // Si aucun dans la tolérance horaire, prendre le plus proche hors tolérance
            if (chunk.length === 2) {
              for (const cand of free) {
                const c = cand.club || 'NONE';
                if ((clubCount[c] || 0) >= maxSameClub) continue;
                chunk = [...chunk, cand];
                break;
              }
            }
          }

          const times = chunk.map((m) => m.arrivalMin).filter((x) => x != null);
          const startMin = times.length ? Math.min(...times) : null;
          const startLabel = startMin != null ? minutesToTime(startMin) : '—';
          const filled = chunk.length === 3 && members.slice(i, i + squadSize).length === 2;
          const squadName =
            chunk.length === members.length || members.length <= squadSize
              ? `Forcé ${label}${filled ? ' +1' : ''} · ${startLabel}`
              : `Forcé ${label} (${Math.floor(i / squadSize) + 1}) · ${startLabel}`;
          await createSquadRound(
            squadName,
            chunk.map((c) => c.user_id),
            startLabel
          );
        }
      }
    }

    // 2) Reste : tirage auto
    let remaining = pool.filter((p) => !assigned.has(p.user_id));
    remaining.sort((a, b) => {
      const am = a.arrivalMin ?? 9999;
      const bm = b.arrivalMin ?? 9999;
      if (am !== bm) return am - bm;
      return a.name.localeCompare(b.name, 'fr');
    });

    let squadIndex = createdSquads.length + 1;
    let lastStart = null;

    while (remaining.length >= 2) {
      const seed = remaining[0];
      const seedMin = seed.arrivalMin;
      const candidates = remaining.filter((p) => {
        if (seedMin == null || p.arrivalMin == null) return true;
        return Math.abs(p.arrivalMin - seedMin) <= tolerance;
      });

      const squad = [];
      const clubCount = {};

      function tryAdd(p) {
        const c = p.club || 'NONE';
        if ((clubCount[c] || 0) >= maxSameClub) return false;
        squad.push(p);
        clubCount[c] = (clubCount[c] || 0) + 1;
        return true;
      }

      tryAdd(seed);
      for (const p of candidates) {
        if (squad.length >= maxSquadSize) break;
        if (p.user_id === seed.user_id) continue;
        tryAdd(p);
      }

      // Si < 2, élargir sans contrainte horaire
      if (squad.length < 2) {
        for (const p of remaining) {
          if (squad.length >= 2) break;
          if (squad.find((x) => x.user_id === p.user_id)) continue;
          tryAdd(p);
        }
      }

      if (squad.length < 2) break;

      // Max 3 ; si reste 1 isolé → squads de 2+2
      let target = Math.min(squadSize, maxSquadSize, squad.length);
      const afterIfTarget = remaining.length - target;
      if (afterIfTarget === 1 && target === 3 && remaining.length >= 4) {
        target = 2;
      }
      let finalSquad = squad.slice(0, Math.min(target, squad.length));
      if (finalSquad.length < 2) break;

      const times = finalSquad.map((m) => m.arrivalMin).filter((x) => x != null);
      let startMin = times.length ? Math.min(...times) : null;
      if (startMin != null && lastStart != null && startMin < lastStart + interval) {
        startMin = lastStart + interval;
      }
      if (startMin != null) lastStart = startMin;
      const startLabel = startMin != null ? minutesToTime(startMin) : '—';

      await createSquadRound(
        `Squad ${squadIndex} · départ ${startLabel}`,
        finalSquad.map((c) => c.user_id),
        startLabel
      );
      squadIndex += 1;

      const used = new Set(finalSquad.map((c) => c.user_id));
      remaining = remaining.filter((p) => !used.has(p.user_id));
    }

    await t.commit();

    res.status(201).json({
      message: `${createdSquads.length} squad(s) créé(s)`,
      squads: createdSquads,
      unassigned: remaining.map((p) => ({
        user_id: p.user_id,
        name: p.name,
        arrival: p.arrival,
        club: p.club,
      })),
    });
  } catch (err) {
    await t.rollback();
    console.error('composeSquads', err);
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}

