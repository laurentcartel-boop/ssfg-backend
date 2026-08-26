const {
  Competition,
  Round,
  RoundPlayer,
  HoleScore,
  Course,
  User,
  sequelize,
} = require('../models');
const { calculateIndexChange } = require('../services/indexService');

/**
 * GET /api/competitions
 */
async function listCompetitions(req, res) {
  try {
    const { status, year, limit = 50 } = req.query;
    const where = {};
    if (status) where.status = status;
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
              model: RoundPlayer,
              as: 'players',
              include: [
                {
                  model: User,
                  as: 'user',
                  attributes: ['id', 'first_name', 'last_name', 'index_value', 'gender', 'club_id'],
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

        leaderboard.push({
          user_id: rp.user_id,
          first_name: rp.user?.first_name,
          last_name: rp.user?.last_name,
          index_value: startingIndex,
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

    res.json({
      competition,
      leaderboard,
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
    const { name, course_id, date } = req.body;
    if (!name || !course_id || !date) {
      return res.status(400).json({ error: 'name, course_id et date sont obligatoires' });
    }

    const course = await Course.findByPk(course_id);
    if (!course) return res.status(404).json({ error: 'Parcours non trouvé' });

    const competition = await Competition.create({
      name: name.trim(),
      course_id,
      date,
      status: 'open',
      created_by: req.user.id,
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
        status: 'in_progress',
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
      return res.json({
        competition,
        message: 'Lancement annulé — composition modifiable à nouveau',
      });
    }

    const squads = competition.squads || [];
    if (squads.length === 0) {
      return res.status(400).json({ error: 'Aucun squad — composez avant de lancer' });
    }
    await competition.update({ launched_at: new Date() });
    res.json({
      competition,
      message: 'Compétition lancée — live scoring actif, composition figée',
    });
  } catch (err) {
    console.error('launchCompetition', err);
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

    // squad_size = taille préférée (3), max_squad_size = plafond (4)
    const squadSize = Number(req.body.squad_size) || 3;
    const maxSquadSize = Number(req.body.max_squad_size) || 4;
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
          status: 'in_progress',
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

    // 1) Groupes forcés → squads
    if (createForced) {
      const byGroup = new Map();
      for (const p of pool) {
        if (!p.forced_group) continue;
        if (assigned.has(p.user_id)) continue;
        if (!byGroup.has(p.forced_group)) byGroup.set(p.forced_group, []);
        byGroup.get(p.forced_group).push(p);
      }
      for (const [label, members] of byGroup) {
        if (members.length < 2) continue; // min 2 pour un squad
        // si > 4, découper en paquets de squadSize
        for (let i = 0; i < members.length; i += Math.max(squadSize, 2)) {
          const chunk = members.slice(i, i + Math.max(squadSize, 4));
          if (chunk.length < 2) break;
          const times = chunk.map((m) => m.arrivalMin).filter((x) => x != null);
          const startMin = times.length ? Math.min(...times) : null;
          const startLabel = startMin != null ? minutesToTime(startMin) : '—';
          const squadName =
            chunk.length === members.length
              ? `Forcé ${label} · ${startLabel}`
              : `Forcé ${label} (${i / squadSize + 1}) · ${startLabel}`;
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

      // Préférer 3, autoriser 4 ; jamais laisser 1 seul
      let target = Math.min(squadSize, squad.length);
      const afterIfTarget = remaining.length - target;
      if (afterIfTarget === 1 && squad.length >= 4) {
        // 3+1 → plutôt 4, ou 2+2
        target = 4;
      } else if (afterIfTarget === 1 && squad.length === 3) {
        target = 2; // 2+2 au prochain tour si possible
      } else if (squad.length > squadSize && remaining.length - squadSize !== 1) {
        target = squadSize;
      } else if (squad.length >= maxSquadSize) {
        target = maxSquadSize;
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

