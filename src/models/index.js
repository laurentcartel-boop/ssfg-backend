const sequelize = require('../config/database');
const User = require('./User');
const Club = require('./Club');
const Course = require('./Course');
const Round = require('./Round');
const RoundPlayer = require('./RoundPlayer');
const HoleScore = require('./HoleScore');
const IndexHistory = require('./IndexHistory');
const Competition = require('./Competition');
const CompetitionRegistration = require('./CompetitionRegistration');
const Article = require('./Article');
const ClubEventLog = require('./ClubEventLog');
const ArticleLike = require('./ArticleLike');
const ArticleComment = require('./ArticleComment');
const MatchPlayChampionship = require('./MatchPlayChampionship');
const MatchPlayMatch = require('./MatchPlayMatch');
let MarcassinsEdition = null;
let MarcassinsTeam = null;
let MarcassinsRegistration = null;
try {
  MarcassinsEdition = require('./MarcassinsEdition');
  MarcassinsTeam = require('./MarcassinsTeam');
  MarcassinsRegistration = require('./MarcassinsRegistration');
} catch (e) {
  console.warn('⚠️ Modèles Marcassins absents:', e.message);
}
const AccountingEntry = require('./AccountingEntry');
const Invoice = require('./Invoice');
const RoundComment = require('./RoundComment');
const RoundExploit = require('./RoundExploit');

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
Competition.belongsTo(Club, { foreignKey: 'club_id', as: 'club', constraints: false });
Club.hasMany(Competition, { foreignKey: 'club_id', as: 'competitions', constraints: false });
MatchPlayChampionship.belongsTo(Club, { foreignKey: 'club_id', as: 'club', constraints: false });
Competition.hasMany(CompetitionRegistration, { foreignKey: 'competition_id', as: 'registrations' });
CompetitionRegistration.belongsTo(Competition, { foreignKey: 'competition_id', as: 'competition' });
CompetitionRegistration.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(CompetitionRegistration, { foreignKey: 'user_id', as: 'competitionRegistrations' });

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
Invoice.belongsTo(User, { foreignKey: 'created_by', as: 'creator', constraints: false });


Round.hasMany(RoundComment, { foreignKey: 'round_id', as: 'comments', constraints: false });
RoundComment.belongsTo(Round, { foreignKey: 'round_id', as: 'round', constraints: false });
RoundComment.belongsTo(User, { foreignKey: 'user_id', as: 'user', constraints: false });
Round.hasMany(RoundExploit, { foreignKey: 'round_id', as: 'exploits', constraints: false });
RoundExploit.belongsTo(Round, { foreignKey: 'round_id', as: 'round', constraints: false });
RoundExploit.belongsTo(User, { foreignKey: 'user_id', as: 'user', constraints: false });
RoundExploit.belongsTo(User, { foreignKey: 'created_by', as: 'creator', constraints: false });



Club.hasMany(User, { foreignKey: 'club_id', as: 'players', constraints: false });

if (MarcassinsEdition && MarcassinsTeam) {
  MarcassinsEdition.belongsTo(Course, { foreignKey: 'course_id', as: 'course', constraints: false });
  MarcassinsEdition.belongsTo(User, { foreignKey: 'created_by', as: 'creator', constraints: false });
  MarcassinsEdition.hasMany(MarcassinsTeam, { foreignKey: 'edition_id', as: 'teams' });
  MarcassinsEdition.belongsTo(MarcassinsTeam, { foreignKey: 'winner_team_id', as: 'winner', constraints: false });
  MarcassinsTeam.belongsTo(MarcassinsEdition, { foreignKey: 'edition_id', as: 'edition' });
  MarcassinsTeam.belongsTo(User, { foreignKey: 'player_a_id', as: 'playerA', constraints: false });
  MarcassinsTeam.belongsTo(User, { foreignKey: 'player_b_id', as: 'playerB', constraints: false });
}
if (MarcassinsEdition && MarcassinsRegistration) {
  MarcassinsEdition.hasMany(MarcassinsRegistration, { foreignKey: 'edition_id', as: 'registrations' });
  MarcassinsRegistration.belongsTo(MarcassinsEdition, { foreignKey: 'edition_id', as: 'edition' });
  MarcassinsRegistration.belongsTo(User, { foreignKey: 'user_id', as: 'user', constraints: false });
}

Article.hasMany(ArticleLike, { foreignKey: 'article_id', as: 'likes', constraints: false });
Article.hasMany(ArticleComment, { foreignKey: 'article_id', as: 'comments', constraints: false });
ArticleLike.belongsTo(Article, { foreignKey: 'article_id', as: 'article', constraints: false });
ArticleLike.belongsTo(User, { foreignKey: 'user_id', as: 'user', constraints: false });
ArticleComment.belongsTo(Article, { foreignKey: 'article_id', as: 'article', constraints: false });
ArticleComment.belongsTo(User, { foreignKey: 'user_id', as: 'user', constraints: false });

User.belongsTo(Club, { foreignKey: 'club_id', as: 'club', constraints: false });

module.exports = {
  sequelize,
  User,
  Club,
  Course,
  Round,
  RoundPlayer,
  HoleScore,
  IndexHistory,
  Competition,
  CompetitionRegistration,
  Article,
  ClubEventLog,
  ArticleLike,
  ArticleComment,
  MatchPlayChampionship,
  MatchPlayMatch,
  AccountingEntry,
  Invoice,
  RoundComment,
  RoundExploit,
  MarcassinsEdition,
  MarcassinsTeam,
  MarcassinsRegistration,
};
