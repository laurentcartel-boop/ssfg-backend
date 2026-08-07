const {
  Competition,
  Round,
  RoundPlayer,
  HoleScore,
  Course,
  User,
  sequelize,
} = require('../models');

async function listCompetitions(req, res) {
  try {
    const { status, limit = 50 } = req.query;
    const where = {};
    if (status) where.status = status;

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
                  attributes: ['id', 'first_name', 'last_name', 'index_value', 'gender'],
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

    leaderboard.sort((a, b) => {
      if (b.holes_played !== a.holes_played) return b.holes_played - a.holes_played;
      if (a.to_par !== b.to_par) return (a.to_par ?? 99) - (b.to_par ?? 99);
      return a.total_strokes - b.total_strokes;
    });

    res.json({ competition, leaderboard });
  } catch (err) {
    console.error('getCompetition error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

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

module.exports = {
  listCompetitions,
  getCompetition,
  createCompetition,
  addSquad,
  closeCompetition,
};
