const sequelize = require('../config/database');
const User = require('./User');
const Course = require('./Course');
const Round = require('./Round');
const RoundPlayer = require('./RoundPlayer');
const HoleScore = require('./HoleScore');
const IndexHistory = require('./IndexHistory');
const Competition = require('./Competition');
const Article = require('./Article');
const MatchPlayChampionship = require('./MatchPlayChampionship');
const MatchPlayMatch = require('./MatchPlayMatch');
const AccountingEntry = require('./AccountingEntry');
const RoundComment = require('./RoundComment');

// Users / Rounds
User.hasMany(Round, { foreignKey: 'created_by', as: 'createdRounds' });
User.hasMany(Round, { foreignKey: 'closed_by', as: 'closedRounds' });
User.hasMany(RoundPlayer, { foreignKey: 'user_id', as: 'roundParticipations' });
User.hasMany(IndexHistory, { foreignKey: 'user_id', as: 'indexHistory' });
User.hasMany(Competition, { foreignKey: 'created_by', as: 'createdCompetitions' });

// Courses
Course.hasMany(Round, { foreignKey: 'course_id', as: 'rounds' });
Course.hasMany(Competition, { foreignKey: 'course_id', as: 'competitions' });
Round.belongsTo(Course, { foreignKey: 'course_id', as: 'course' });

// Rounds
Round.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
Round.belongsTo(User, { foreignKey: 'closed_by', as: 'closer' });
Round.belongsTo(Competition, { foreignKey: 'competition_id', as: 'competition' });
Round.hasMany(RoundPlayer, { foreignKey: 'round_id', as: 'players' });

// Competitions
Competition.belongsTo(Course, { foreignKey: 'course_id', as: 'course' });
Competition.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
Competition.belongsTo(User, { foreignKey: 'closed_by', as: 'closer' });
Competition.hasMany(Round, { foreignKey: 'competition_id', as: 'squads' });

// Round players / scores
RoundPlayer.belongsTo(Round, { foreignKey: 'round_id', as: 'round' });
RoundPlayer.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
RoundPlayer.hasMany(HoleScore, { foreignKey: 'round_player_id', as: 'holeScores' });

HoleScore.belongsTo(RoundPlayer, { foreignKey: 'round_player_id', as: 'roundPlayer' });
HoleScore.belongsTo(User, { foreignKey: 'updated_by', as: 'updater' });

IndexHistory.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
IndexHistory.belongsTo(Round, { foreignKey: 'round_id', as: 'round' });

User.hasMany(Article, { foreignKey: 'created_by', as: 'articles' });
Article.belongsTo(User, { foreignKey: 'created_by', as: 'author' });

// Match Play
MatchPlayChampionship.belongsTo(User, { foreignKey: 'created_by', as: 'creator', constraints: false });
MatchPlayChampionship.hasMany(MatchPlayMatch, { foreignKey: 'championship_id', as: 'matches', constraints: false });
MatchPlayMatch.belongsTo(MatchPlayChampionship, { foreignKey: 'championship_id', as: 'championship', constraints: false });
// constraints: false → permet player_a/b NULL (byes / en attente) sans FK MySQL bloquante
MatchPlayMatch.belongsTo(User, { foreignKey: 'player_a_id', as: 'playerA', constraints: false });
MatchPlayMatch.belongsTo(User, { foreignKey: 'player_b_id', as: 'playerB', constraints: false });
MatchPlayMatch.belongsTo(User, { foreignKey: 'winner_id', as: 'winner', constraints: false });
MatchPlayMatch.belongsTo(User, { foreignKey: 'created_by', as: 'creator', constraints: false });
AccountingEntry.belongsTo(User, { foreignKey: 'created_by', as: 'creator', constraints: false });

Round.hasMany(RoundComment, { foreignKey: 'round_id', as: 'comments', constraints: false });
RoundComment.belongsTo(Round, { foreignKey: 'round_id', as: 'round', constraints: false });
RoundComment.belongsTo(User, { foreignKey: 'user_id', as: 'user', constraints: false });


module.exports = {
  sequelize,
  User,
  Course,
  Round,
  RoundPlayer,
  HoleScore,
  IndexHistory,
  Competition,
  Article,
  MatchPlayChampionship,
  MatchPlayMatch,
  AccountingEntry,
  RoundComment,
};
