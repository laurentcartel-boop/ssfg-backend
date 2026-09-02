const {
  Round,
  RoundPlayer,
  HoleScore,
  Course,
  User,
  IndexHistory,
  RoundComment,
  RoundExploit,
  sequelize,
} = require('../models');
const { calculateIndexChange } = require('../services/indexService');
const { Op } = require('sequelize');

/**
 * GET /api/rounds
 * Liste des parties (filtrable par status, type, date)
 */
async function listRounds(req, res) {
  try {
    const { status, type, limit = 50 } = req.query;
    const where = {};

    if (status) where.status = status;
    if (type) where.type = type;

    const rounds = await Round.findAll({
      where,
      include: [
        { model: Course, as: 'course', attributes: ['id', 'name', 'short_name', 'par_total'] },
        { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name'] },
        {
          model: RoundPlayer,
          as: 'players',
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'first_name', 'last_name', 'index_value', 'club_id'],
              include: [
                {
                  model: require('../models').Club,
                  as: 'club',
                  attributes: ['id', 'code', 'short_name'],
                  required: false,
                },
              ],
            },
          ],
        },
      ],
      order: [['date', 'DESC'], ['created_at', 'DESC']],
      limit: Math.min(parseInt(limit, 10) || 100, 200),
    });

    res.json({ rounds });
  } catch (err) {
    console.error('listRounds error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * GET /api/rounds/:id
 * Détail d'une partie avec scores
 */
async function getRound(req, res) {
  try {
    const round = await Round.findByPk(req.params.id, {
      include: [
        { model: Course, as: 'course' },
        { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name'] },
        { model: User, as: 'closer', attributes: ['id', 'first_name', 'last_name'] },
        {
          model: RoundPlayer,
          as: 'players',
          include: [
            { model: User, as: 'user', attributes: ['id', 'first_name', 'last_name', 'index_value', 'gender'] },
            { model: HoleScore, as: 'holeScores' },
          ],
        },
      ],
    });

    if (!round) {
      return res.status(404).json({ error: 'Partie non trouvée' });
    }

    res.json({ round });
  } catch (err) {
    console.error('getRound error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * POST /api/rounds
 * Créer une partie (Admin ou Super-admin)
 * Body: { name, type, course_id, date, player_ids: [] }
 */
async function createRound(req, res) {
  const t = await sequelize.transaction();
  try {
    const { name, type = 'libre', course_id, date, player_ids = [] } = req.body;

    if (!name || !course_id || !date) {
      await t.rollback();
      return res.status(400).json({ error: 'name, course_id et date sont obligatoires' });
    }

    if (!['libre', 'competition', 'entrainement'].includes(type)) {
      await t.rollback();
      return res.status(400).json({ error: 'type doit être libre ou competition' });
    }

    const minPlayers = type === 'entrainement' ? 1 : 2;
    if (player_ids.length < minPlayers) {
      await t.rollback();
      return res.status(400).json({
        error: type === 'entrainement' ? '1 joueur requis' : 'Minimum 2 joueurs requis',
      });
    }

    const course = await Course.findByPk(course_id);
    if (!course || !course.is_active) {
      await t.rollback();
      return res.status(400).json({ error: 'Parcours invalide' });
    }

    // Vérifier que tous les joueurs existent
    const players = await User.findAll({
      where: { id: { [Op.in]: player_ids }, is_active: true },
    });
    if (players.length !== player_ids.length) {
      await t.rollback();
      return res.status(400).json({ error: 'Un ou plusieurs joueurs sont invalides' });
    }

    const round = await Round.create(
      {
        name: name.trim(),
        type,
        course_id,
        date,
        status: 'in_progress',
        created_by: req.user.id,
      },
      { transaction: t }
    );

    // Créer les RoundPlayer avec l'index actuel
    for (const player of players) {
      await RoundPlayer.create(
        {
          round_id: round.id,
          user_id: player.id,
          starting_index: player.index_value,
        },
        { transaction: t }
      );
    }

    await t.commit();

    // Recharger avec les relations
    const fullRound = await Round.findByPk(round.id, {
      include: [
        { model: Course, as: 'course' },
        {
          model: RoundPlayer,
          as: 'players',
          include: [{ model: User, as: 'user', attributes: ['id', 'first_name', 'last_name', 'index_value'] }],
        },
      ],
    });

    res.status(201).json({ round: fullRound, message: 'Partie créée' });
  } catch (err) {
    await t.rollback();
    console.error('createRound error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * POST /api/rounds/:id/players
 * Ajouter un joueur à une partie en cours (Admin)
 * Body: { user_id }
 */
async function addPlayer(req, res) {
  try {
    const round = await Round.findByPk(req.params.id);
    if (!round) return res.status(404).json({ error: 'Partie non trouvée' });
    if (round.status === 'closed') {
      return res.status(400).json({ error: 'Partie déjà clôturée' });
    }
    if (round.status === 'draft') {
      return res.status(400).json({
        error: 'Squad en préparation — lancez la compétition pour saisir les scores',
      });
    }

    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id requis' });

    const user = await User.findByPk(user_id);
    if (!user || !user.is_active) {
      return res.status(400).json({ error: 'Joueur invalide' });
    }

    const existing = await RoundPlayer.findOne({
      where: { round_id: round.id, user_id },
    });
    if (existing) {
      return res.status(409).json({ error: 'Joueur déjà dans la partie' });
    }

    const rp = await RoundPlayer.create({
      round_id: round.id,
      user_id,
      starting_index: user.index_value,
    });

    res.status(201).json({ roundPlayer: rp, message: 'Joueur ajouté' });
  } catch (err) {
    console.error('addPlayer error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * PUT /api/rounds/:id/scores
 * Saisir / mettre à jour les scores d'un trou
 * Body: { hole_number, scores: [{ user_id, score }] }
 *
 * Accessible aux joueurs de la partie + admins
 */
async function updateHoleScores(req, res) {
  const t = await sequelize.transaction();
  try {
    const round = await Round.findByPk(req.params.id, {
      include: [{ model: Course, as: 'course' }, { model: RoundPlayer, as: 'players' }],
      transaction: t,
    });

    if (!round) {
      await t.rollback();
      return res.status(404).json({ error: 'Partie non trouvée' });
    }
    if (round.status === 'closed') {
      await t.rollback();
      return res.status(400).json({ error: 'Partie clôturée – modification interdite' });
    }
    if (round.status === 'draft') {
      await t.rollback();
      return res.status(400).json({
        error: 'Squad en préparation — lancez la compétition pour le live scoring',
      });
    }

    const { hole_number, scores } = req.body;

    if (!hole_number || hole_number < 1 || hole_number > 18) {
      await t.rollback();
      return res.status(400).json({ error: 'hole_number invalide (1-18)' });
    }
    if (!Array.isArray(scores) || scores.length === 0) {
      await t.rollback();
      return res.status(400).json({ error: 'scores requis' });
    }

    // Vérifier que l'utilisateur a le droit (admin/super_admin ou joueur de la partie)
    const isAdmin = ['admin', 'super_admin', 'platine_admin'].includes(req.user.role);
    const isPlayer = round.players.some((p) => p.user_id === req.user.id);
    if (!isAdmin && !isPlayer) {
      await t.rollback();
      return res.status(403).json({ error: 'Vous ne participez pas à cette partie' });
    }
    if (round.scoring_user_id && round.scoring_user_id !== req.user.id && !isAdmin) {
      await t.rollback();
      return res.status(403).json({
        error: 'Un autre joueur saisit déjà cette partie. Mode lecture seule.',
      });
    }
    if (!round.scoring_user_id) {
      await round.update({ scoring_user_id: req.user.id }, { transaction: t });
    }

    const holePar = round.course.holes_data.find((h) => h.hole === hole_number)?.par;
    if (!holePar) {
      await t.rollback();
      return res.status(400).json({ error: 'Par du trou introuvable' });
    }

    const results = [];

    for (const item of scores) {
      const { user_id, score } = item;
      if (!user_id || !score || score < 1) {
        await t.rollback();
        return res.status(400).json({ error: 'Chaque score doit avoir user_id et score >= 1' });
      }

      const rp = round.players.find((p) => p.user_id === user_id);
      if (!rp) {
        await t.rollback();
        return res.status(400).json({ error: `Joueur ${user_id} absent de la partie` });
      }

      // Upsert du score
      let holeScore = await HoleScore.findOne({
        where: { round_player_id: rp.id, hole_number },
        transaction: t,
      });

      if (holeScore) {
        await holeScore.update(
          { score, par: holePar, updated_by: req.user.id },
          { transaction: t }
        );
      } else {
        holeScore = await HoleScore.create(
          {
            round_player_id: rp.id,
            hole_number,
            score,
            par: holePar,
            updated_by: req.user.id,
          },
          { transaction: t }
        );
      }

      results.push(holeScore);
    }

    await t.commit();
    res.json({ scores: results, message: `Trou ${hole_number} enregistré` });
  } catch (err) {
    await t.rollback();
    console.error('updateHoleScores error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * POST /api/rounds/:id/close
 * Clôturer une partie (Super-admin uniquement)
 * → Calcule les totaux + met à jour les index
 */
async function closeRound(req, res) {
  const t = await sequelize.transaction();
  try {
    const round = await Round.findByPk(req.params.id, {
      include: [
        { model: Course, as: 'course' },
        {
          model: RoundPlayer,
          as: 'players',
          include: [
            { model: User, as: 'user' },
            { model: HoleScore, as: 'holeScores' },
          ],
        },
      ],
      transaction: t,
    });

    if (!round) {
      await t.rollback();
      return res.status(404).json({ error: 'Partie non trouvée' });
    }
    if (round.status === 'closed') {
      await t.rollback();
      return res.status(400).json({ error: 'Partie déjà clôturée' });
    }

    const parTotal = round.course.par_total;
    const updates = [];

    for (const rp of round.players) {
      const scores = rp.holeScores || [];

      // DNF : score partiel conservé, pas de validation index
      if (rp.dnf) {
        const partial = scores.reduce((sum, hs) => sum + hs.score, 0);
        const thru = scores.length;
        await rp.update(
          {
            total_score: thru > 0 ? partial : null,
            score_to_par: null,
            net_score: null,
            index_change: null,
            new_index: Number(rp.starting_index),
          },
          { transaction: t }
        );
        updates.push({
          user_id: rp.user_id,
          name: `${rp.user.first_name} ${rp.user.last_name}`,
          total_score: thru > 0 ? partial : null,
          score_to_par: null,
          index_change: null,
          new_index: Number(rp.starting_index),
          dnf: true,
          holes_played: thru,
        });
        continue;
      }

      if (scores.length < 18) {
        await t.rollback();
        return res.status(400).json({
          error: `Le joueur ${rp.user.first_name} ${rp.user.last_name} n'a pas 18 trous saisis (${scores.length}/18). Marquez-le DNF s'il abandonne.`,
        });
      }

      const totalScore = scores.reduce((sum, hs) => sum + hs.score, 0);
      const scoreToPar = totalScore - parTotal;
      const netScore = Math.round((totalScore - Number(rp.starting_index)) * 10) / 10;

      const isTraining = round.type === 'entrainement';
      let change = 0;
      let newIndex = Number(rp.starting_index);

      if (!isTraining) {
        const result = calculateIndexChange(totalScore, parTotal, rp.starting_index);
        change = result.change;
        newIndex = result.newIndex;
      }

      await rp.update(
        {
          total_score: totalScore,
          score_to_par: scoreToPar,
          net_score: netScore,
          index_change: change,
          new_index: newIndex,
        },
        { transaction: t }
      );

      if (!isTraining) {
        const oldIndex = Number(rp.user.index_value);
        await rp.user.update(
          {
            index_value: newIndex,
            last_round_date: round.date,
          },
          { transaction: t }
        );
        await IndexHistory.create(
          {
            user_id: rp.user_id,
            old_index: oldIndex,
            new_index: newIndex,
            change,
            reason: 'round',
            round_id: round.id,
          },
          { transaction: t }
        );
      }

      updates.push({
        user_id: rp.user_id,
        name: `${rp.user.first_name} ${rp.user.last_name}`,
        total_score: totalScore,
        score_to_par: scoreToPar,
        index_change: change,
        new_index: newIndex,
        dnf: false,
      });
    }

    await round.update(
      {
        status: 'closed',
        closed_by: req.user.id,
        closed_at: new Date(),
      },
      { transaction: t }
    );

    await t.commit();

    try {
      const { MarcassinsTeam } = require('../models');
      const { syncTeamFromLinkedRounds } = require('./marcassinsController');
      const team = await MarcassinsTeam.findOne({
        where: {
          [Op.or]: [
            { morning_round_id: round.id },
            { afternoon_round_id: round.id },
          ],
        },
      });
      if (team && syncTeamFromLinkedRounds) await syncTeamFromLinkedRounds(team);
    } catch (e) {
      console.warn('sync marcassins after close', e.message);
    }

    res.json({
      message: round.type === 'entrainement' ? 'Entraînement clôturé (hors index)' : 'Partie clôturée – index mis à jour',
      results: updates,
    });
  } catch (err) {
    await t.rollback();
    console.error('closeRound error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}


/**
 * DELETE /api/rounds/:id/players/:userId
 * Retirer un joueur (admin) si aucun score saisi
 */
async function removePlayer(req, res) {
  try {
    const round = await Round.findByPk(req.params.id, {
      include: [{ model: RoundPlayer, as: 'players', include: [{ model: HoleScore, as: 'holeScores' }] }],
    });
    if (!round) return res.status(404).json({ error: 'Partie non trouvée' });
    if (round.status === 'closed') {
      return res.status(400).json({ error: 'Partie déjà clôturée' });
    }

    const rp = (round.players || []).find((p) => p.user_id === req.params.userId);
    if (!rp) return res.status(404).json({ error: 'Joueur absent de la partie' });

    if (rp.holeScores && rp.holeScores.length > 0) {
      return res.status(400).json({ error: 'Impossible : des scores sont déjà saisis pour ce joueur' });
    }

    if ((round.players || []).length <= 2 && round.type !== 'entrainement') {
      return res.status(400).json({ error: 'Minimum 2 joueurs dans la partie' });
    }

    await rp.destroy();
    res.json({ message: 'Joueur retiré' });
  } catch (err) {
    console.error('removePlayer error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}


/**
 * POST /api/rounds/:id/players/:userId/dnf
 * Marquer / retirer DNF (Did Not Finish) — admin ou joueur de la partie
 */
async function setPlayerDnf(req, res) {
  try {
    const round = await Round.findByPk(req.params.id, {
      include: [{ model: RoundPlayer, as: 'players', include: [{ model: User, as: 'user' }] }],
    });
    if (!round) return res.status(404).json({ error: 'Partie non trouvée' });
    if (round.status === 'closed') {
      return res.status(400).json({ error: 'Partie déjà clôturée' });
    }

    const rp = (round.players || []).find((p) => p.user_id === req.params.userId);
    if (!rp) return res.status(404).json({ error: 'Joueur absent de la partie' });

    const dnf = req.body?.dnf !== undefined ? Boolean(req.body.dnf) : !rp.dnf;
    await rp.update({ dnf });

    res.json({
      message: dnf
        ? `${rp.user?.last_name || 'Joueur'} marqué DNF (score non compté pour l'index)`
        : `DNF retiré pour ${rp.user?.last_name || 'joueur'}`,
      player: {
        user_id: rp.user_id,
        dnf,
        last_name: rp.user?.last_name,
        first_name: rp.user?.first_name,
      },
    });
  } catch (err) {
    console.error('setPlayerDnf error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}


/**
 * DELETE /api/rounds/:id — super-admin : supprimer une partie (erreur / test)
 */
const DELETE_REASONS = [
  'test_appli',
  'demo',
  'illegal',
  'fake_player_index',
  'error_create',
  'duplicate',
  'other',
];

async function writeClubLog({ actor_id, action, entity_type, entity_id, reason, note, payload }) {
  try {
    const { ClubEventLog } = require('../models');
    if (!ClubEventLog) return;
    await ClubEventLog.create({
      actor_id,
      action,
      entity_type,
      entity_id: entity_id ? String(entity_id) : null,
      reason: reason || null,
      note: note || null,
      payload: payload || null,
    });
  } catch (e) {
    console.warn('club log', e.message);
  }
}

async function setInvestigation(req, res) {
  try {
    const round = await Round.findByPk(req.params.id);
    if (!round) return res.status(404).json({ error: 'Partie non trouvée' });
    const on = Boolean(req.body.under_investigation);
    const note = req.body.note ? String(req.body.note).slice(0, 255) : null;
    await round.update({ under_investigation: on, investigation_note: on ? note : null });
    await writeClubLog({
      actor_id: req.user.id,
      action: on ? 'investigate_on' : 'investigate_off',
      entity_type: 'round',
      entity_id: round.id,
      note,
      payload: { name: round.name, status: round.status },
    });
    res.json({
      message: on ? 'Partie placée sous enquête' : 'Enquête levée',
      under_investigation: on,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}


async function claimScoring(req, res) {
  try {
    const round = await Round.findByPk(req.params.id, {
      include: [{ model: RoundPlayer, as: 'players' }],
    });
    if (!round) return res.status(404).json({ error: 'Partie non trouvée' });
    if (round.status === 'closed') {
      return res.status(400).json({ error: 'Partie clôturée' });
    }
    const isAdmin = ['admin', 'super_admin', 'platine_admin'].includes(req.user.role);
    const isPlayer = (round.players || []).some((p) => p.user_id === req.user.id);
    if (!isAdmin && !isPlayer) {
      return res.status(403).json({ error: 'Pas dans cette partie' });
    }
    const force = Boolean(req.body?.force) && (isAdmin || isPlayer);
    if (round.scoring_user_id && round.scoring_user_id !== req.user.id && !force) {
      return res.status(409).json({
        error: 'Déjà un scoreur',
        scoring_user_id: round.scoring_user_id,
      });
    }
    await round.update({ scoring_user_id: req.user.id });
    res.json({ message: 'Tu saisis cette partie', scoring_user_id: req.user.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function listCloseAlerts(req, res) {
  try {
    const rounds = await Round.findAll({
      where: { status: 'in_progress' },
      include: [
        { model: RoundPlayer, as: 'players', include: [{ model: HoleScore, as: 'holeScores' }] },
        { model: Course, as: 'course', attributes: ['short_name'] },
      ],
      order: [['updated_at', 'DESC']],
      limit: 50,
    });
    const twoH = Date.now() - 2 * 60 * 60 * 1000;
    const alerts = [];
    for (const round of rounds) {
      const players = round.players || [];
      if (!players.length) continue;
      let last = round.updatedAt ? new Date(round.updatedAt).getTime() : 0;
      let complete = true;
      for (const rp of players) {
        const holes = (rp.holeScores || []).filter((h) => Number(h.score) >= 1);
        if (holes.length < 18) complete = false;
        for (const h of rp.holeScores || []) {
          const ts = new Date(h.updatedAt || h.createdAt || 0).getTime();
          if (ts > last) last = ts;
        }
      }
      const stale = last && last < twoH;
      if (complete || stale) {
        alerts.push({
          id: round.id,
          name: round.name,
          date: round.date,
          course: round.course?.short_name,
          complete,
          stale,
          hours: last ? Math.round((Date.now() - last) / 3600000) : null,
        });
      }
    }
    res.json({ alerts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function deleteRound(req, res) {
  const t = await sequelize.transaction();
  try {
    const round = await Round.findByPk(req.params.id, {
      include: [{ model: RoundPlayer, as: 'players', include: [{ model: HoleScore, as: 'holeScores' }] }],
      transaction: t,
    });
    if (!round) {
      await t.rollback();
      return res.status(404).json({ error: 'Partie non trouvée' });
    }

    const reason = String(req.body?.reason || req.query.reason || '').trim();
    const note = String(req.body?.note || '').trim().slice(0, 500);
    const pin = String(req.body?.password || req.body?.pin || '');
    const expectedPin = process.env.DELETE_TEST_PIN || 'SSFG-TEST';
    const testDelete = ['test_appli', 'demo'].includes(reason);

    if (round.status === 'in_progress' && !testDelete) {
      await t.rollback();
      return res.status(403).json({
        error:
          'Partie en cours : suppression interdite. Place-la sous enquête, ou indique le motif test/démo + mot de passe.',
      });
    }
    if (!DELETE_REASONS.includes(reason)) {
      await t.rollback();
      return res.status(400).json({
        error: 'Motif obligatoire',
        reasons: DELETE_REASONS,
      });
    }
    if (testDelete && pin !== expectedPin) {
      await t.rollback();
      return res.status(403).json({ error: 'Mot de passe test / démo incorrect' });
    }
    if (round.status === 'closed' && !reason) {
      await t.rollback();
      return res.status(400).json({ error: 'Motif obligatoire pour une partie terminée' });
    }

    const snapshot = {
      name: round.name,
      type: round.type,
      date: round.date,
      status: round.status,
      players: (round.players || []).length,
    };

    for (const rp of round.players || []) {
      await HoleScore.destroy({ where: { round_player_id: rp.id }, transaction: t });
    }
    await RoundPlayer.destroy({ where: { round_id: round.id }, transaction: t });
    await round.destroy({ transaction: t });
    await t.commit();

    await writeClubLog({
      actor_id: req.user.id,
      action: 'round_delete',
      entity_type: 'round',
      entity_id: snapshot.name,
      reason,
      note,
      payload: snapshot,
    });

    res.json({ message: 'Partie supprimée', reason });
  } catch (err) {
    await t.rollback();
    console.error('deleteRound', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}



async function listComments(req, res) {
  try {
    const comments = await RoundComment.findAll({
      where: { round_id: req.params.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'first_name', 'last_name'] }],
      order: [['created_at', 'ASC']],
      limit: 500,
    });
    res.json({
      comments: comments.map((c) => ({
        id: c.id,
        message: c.message,
        created_at: c.createdAt || c.created_at,
        display_name: c.display_name,
        user: c.user,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function addComment(req, res) {
  try {
    const round = await Round.findByPk(req.params.id, {
      include: [{ model: RoundPlayer, as: 'players' }],
    });
    if (!round) return res.status(404).json({ error: 'Partie non trouvée' });
    if (round.status === 'closed') {
      return res.status(400).json({ error: 'Partie clôturée' });
    }
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
    const isPlayer = (round.players || []).some((p) => p.user_id === req.user.id);
    if (!isAdmin && !isPlayer) {
      return res.status(403).json({ error: 'Réservé aux joueurs de la partie' });
    }
    const message = String(req.body.message || '').trim().slice(0, 280);
    if (!message) return res.status(400).json({ error: 'Message vide' });
    const c = await RoundComment.create({
      round_id: round.id,
      user_id: req.user.id,
      display_name: null,
      message,
    });
    const user = await User.findByPk(req.user.id, {
      attributes: ['id', 'first_name', 'last_name'],
    });
    res.status(201).json({
      comment: {
        id: c.id,
        message: c.message,
        created_at: c.createdAt,
        display_name: null,
        user,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function deleteComment(req, res) {
  try {
    const c = await RoundComment.findByPk(req.params.commentId);
    if (!c || c.round_id !== req.params.id) {
      return res.status(404).json({ error: 'Commentaire introuvable' });
    }
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
    const round = await Round.findByPk(req.params.id, {
      include: [{ model: RoundPlayer, as: 'players' }],
    });
    const isPlayer =
      round &&
      (round.players || []).some((p) => p.user_id === req.user.id);
    // Modération : admin, joueur de la partie, ou auteur du message
    if (!isAdmin && !isPlayer && c.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Non autorisé' });
    }
    await c.destroy();
    res.json({ message: 'Commentaire supprimé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}


async function listExploits(req, res) {
  try {
    const exploits = await RoundExploit.findAll({
      where: { round_id: req.params.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'first_name', 'last_name'] }],
      order: [['hole_number', 'ASC'], ['createdAt', 'ASC']],
    });
    res.json({
      exploits: exploits.map((e) => ({
        id: e.id,
        hole_number: e.hole_number,
        exploit_type: e.exploit_type,
        comment: e.comment,
        image_url: e.image_url,
        created_at: e.createdAt,
        user: e.user,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function addExploit(req, res) {
  try {
    const round = await Round.findByPk(req.params.id, {
      include: [{ model: RoundPlayer, as: 'players' }],
    });
    if (!round) return res.status(404).json({ error: 'Partie non trouvée' });
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
    const isPlayer = (round.players || []).some((p) => p.user_id === req.user.id);
    if (!isAdmin && !isPlayer) {
      return res.status(403).json({ error: 'Réservé aux joueurs de la partie' });
    }
    const hole_number = parseInt(req.body.hole_number, 10);
    const exploit_type = String(req.body.exploit_type || '').toLowerCase();
    const allowed = ['hole_in_one', 'albatross', 'eagle', 'moment'];
    if (!allowed.includes(exploit_type)) {
      return res.status(400).json({ error: 'Type: hole_in_one, albatross, eagle ou moment' });
    }
    if (!hole_number || hole_number < 1 || hole_number > 18) {
      return res.status(400).json({ error: 'Trou invalide' });
    }
    let user_id = req.body.user_id || req.user.id;
    if (!isAdmin && user_id !== req.user.id) {
      // joueur peut enregistrer pour un partenaire du squad
      const ok = (round.players || []).some((p) => p.user_id === user_id);
      if (!ok) return res.status(403).json({ error: 'Joueur hors partie' });
    }
    const e = await RoundExploit.create({
      round_id: round.id,
      user_id,
      hole_number,
      exploit_type,
      comment: req.body.comment ? String(req.body.comment).slice(0, 280) : null,
      image_url: req.body.image_url || null,
      created_by: req.user.id,
    });
    const user = await User.findByPk(user_id, {
      attributes: ['id', 'first_name', 'last_name'],
    });
    res.status(201).json({
      exploit: {
        id: e.id,
        hole_number: e.hole_number,
        exploit_type: e.exploit_type,
        comment: e.comment,
        image_url: e.image_url,
        created_at: e.createdAt,
        user,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function deleteExploit(req, res) {
  try {
    const e = await RoundExploit.findByPk(req.params.exploitId);
    if (!e || e.round_id !== req.params.id) {
      return res.status(404).json({ error: 'Exploit introuvable' });
    }
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
    const round = await Round.findByPk(req.params.id, {
      include: [{ model: RoundPlayer, as: 'players' }],
    });
    const isPlayer =
      round && (round.players || []).some((p) => p.user_id === req.user.id);
    if (!isAdmin && !isPlayer && e.created_by !== req.user.id && e.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Non autorisé' });
    }
    await e.destroy();
    res.json({ message: 'Exploit supprimé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}


async function listExploitsAlbum(req, res) {
  try {
    const year = req.query.year ? parseInt(req.query.year, 10) : null;
    const where = {};
    // Filter by round date year via include
    const { Op } = require('sequelize');
    const includeRound = {
      model: Round,
      as: 'round',
      attributes: ['id', 'name', 'date', 'status'],
      required: true,
    };
    if (year) {
      includeRound.where = {
        date: {
          [Op.gte]: `${year}-01-01`,
          [Op.lte]: `${year}-12-31`,
        },
      };
    }
    const exploits = await RoundExploit.findAll({
      include: [
        includeRound,
        { model: User, as: 'user', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [
        [{ model: Round, as: 'round' }, 'date', 'DESC'],
        ['hole_number', 'ASC'],
      ],
      limit: 500,
    });
    // years available
    const all = await RoundExploit.findAll({
      include: [{ model: Round, as: 'round', attributes: ['date'], required: true }],
      attributes: ['id'],
    });
    const yearsSet = new Set();
    for (const e of all) {
      if (e.round?.date) yearsSet.add(String(e.round.date).slice(0, 4));
    }
    res.json({
      year: year || null,
      years: Array.from(yearsSet).sort().reverse(),
      exploits: exploits.map((e) => ({
        id: e.id,
        hole_number: e.hole_number,
        exploit_type: e.exploit_type,
        comment: e.comment,
        image_url: e.image_url,
        created_at: e.createdAt,
        user: e.user,
        round: e.round
          ? { id: e.round.id, name: e.round.name, date: e.round.date }
          : null,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}


async function updateExploit(req, res) {
  try {
    const e = await RoundExploit.findByPk(req.params.exploitId);
    if (!e || e.round_id !== req.params.id) {
      return res.status(404).json({ error: 'Exploit introuvable' });
    }
    const round = await Round.findByPk(req.params.id, {
      include: [{ model: RoundPlayer, as: 'players' }],
    });
    if (!round) return res.status(404).json({ error: 'Partie non trouvée' });
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
    const isPlayer =
      round && (round.players || []).some((p) => p.user_id === req.user.id);
    if (!isAdmin && !isPlayer && e.created_by !== req.user.id && e.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Non autorisé' });
    }
    const fields = {};
    if (req.body.comment !== undefined) {
      fields.comment = req.body.comment ? String(req.body.comment).slice(0, 280) : null;
    }
    if (req.body.image_url !== undefined) {
      fields.image_url = req.body.image_url || null;
    }
    if (req.body.exploit_type) {
      const allowed = ['hole_in_one', 'albatross', 'eagle', 'moment'];
      const t = String(req.body.exploit_type).toLowerCase();
      if (!allowed.includes(t)) {
        return res.status(400).json({ error: 'Type invalide' });
      }
      fields.exploit_type = t;
    }
    if (req.body.hole_number != null) {
      const h = parseInt(req.body.hole_number, 10);
      if (!h || h < 1 || h > 18) {
        return res.status(400).json({ error: 'Trou invalide' });
      }
      fields.hole_number = h;
    }
    if (req.body.user_id && isAdmin) {
      fields.user_id = req.body.user_id;
    }
    await e.update(fields);
    const user = await User.findByPk(e.user_id, {
      attributes: ['id', 'first_name', 'last_name'],
    });
    res.json({
      exploit: {
        id: e.id,
        hole_number: e.hole_number,
        exploit_type: e.exploit_type,
        comment: e.comment,
        image_url: e.image_url,
        created_at: e.createdAt,
        user,
        round: { id: round.id, name: round.name, date: round.date },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

module.exports = {
  listExploitsAlbum,
  updateExploit,
  listRounds,
  getRound,
  createRound,
  addPlayer,
  removePlayer,
  updateHoleScores,
  closeRound,
  setPlayerDnf,
  deleteRound,
  claimScoring,
  listCloseAlerts,
  setInvestigation,
  writeClubLog,
  listComments,
  addComment,
  deleteComment,
  listExploits,
  addExploit,
  deleteExploit,
};
