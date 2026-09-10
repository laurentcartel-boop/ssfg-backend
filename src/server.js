require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { sequelize } = require('./models');

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : true;

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '15mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'FootGolf Scoring SSFG', version: '1.0.0' });
});

app.use('/api/public', require('./routes/public'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/rounds', require('./routes/rounds'));
app.use('/api/rankings', require('./routes/rankings'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/import', require('./routes/import'));
app.use('/api/bestioles', require('./routes/bestioles'));
app.use('/api/competitions', require('./routes/competitions'));
app.use('/api/articles', require('./routes/articles'));
app.use('/api/club', require('./routes/club'));
app.use('/api/push', require('./routes/push'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/accounting', require('./routes/accounting'));
app.use('/api/matchplay', require('./routes/matchplay'));
try {
  app.use('/api/marcassins', require('./routes/marcassins'));
} catch (e) {
  console.warn('Route Marcassins absente:', e.message);
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Erreur serveur',
  });
});

async function migrateMatchPlay() {
  const [tables] = await sequelize.query("SHOW TABLES LIKE 'matchplay_matches'");
  if (!tables.length) return;
  const [fks] = await sequelize.query(`
    SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'matchplay_matches'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  `);
  for (const row of fks) {
    const name = row.CONSTRAINT_NAME || row.constraint_name;
    try {
      await sequelize.query('ALTER TABLE matchplay_matches DROP FOREIGN KEY `' + name + '`');
    } catch (e) {}
  }
  try { await sequelize.query('ALTER TABLE matchplay_matches MODIFY player_a_id CHAR(36) NULL'); } catch (e) {}
  try { await sequelize.query('ALTER TABLE matchplay_matches MODIFY player_b_id CHAR(36) NULL'); } catch (e) {}
  try { await sequelize.query("ALTER TABLE matchplay_matches ADD COLUMN is_bye TINYINT(1) NOT NULL DEFAULT 0"); } catch (e) {}
}

async function promotePlatine() {
  const { User } = require('./models');
  const raw = process.env.PLATINE_EMAILS || process.env.PLATINE_EMAIL || '';
  const emails = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) return;
  for (const email of emails) {
    const user = await User.findOne({ where: { email } });
    if (!user) continue;
    if (user.role !== 'platine_admin') await user.update({ role: 'platine_admin' });
  }
}

async function seedClubs() {
  const { Club, User } = require('./models');
  try { await sequelize.query('ALTER TABLE users ADD COLUMN club_id CHAR(36) NULL'); } catch (e) {}
  const defaults = [
    { code: 'SSFG', name: 'Saint-Saens FootGolf', short_name: 'SSFG', sort_order: 1 },
    { code: 'AFG', name: 'AFG', short_name: 'AFG', sort_order: 2 },
    { code: 'HAC', name: 'HAC FootGolf', short_name: 'HAC', sort_order: 3 },
    { code: 'RMFC', name: 'RMFC', short_name: 'RMFC', sort_order: 4 },
    { code: 'NONE', name: 'Sans club', short_name: 'Sans club', sort_order: 99 },
  ];
  for (const d of defaults) {
    try {
      await Club.findOrCreate({ where: { code: d.code }, defaults: { ...d, is_active: true } });
    } catch (e) {}
  }
  const ssfg = await Club.findOne({ where: { code: 'SSFG' } });
  if (ssfg) await User.update({ club_id: ssfg.id }, { where: { club_id: null } });
}

async function start() {
  try {
    await sequelize.authenticate();
    try { await sequelize.query('ALTER TABLE users ADD COLUMN notify_actu TINYINT(1) NOT NULL DEFAULT 1'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE users ADD COLUMN notify_chat_inter TINYINT(1) NOT NULL DEFAULT 1'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE users ADD COLUMN notify_chat_club TINYINT(1) NOT NULL DEFAULT 1'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE users ADD COLUMN notify_live TINYINT(1) NOT NULL DEFAULT 1'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE round_players ADD COLUMN counts_for_index TINYINT(1) NOT NULL DEFAULT 1'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE article_comments ADD COLUMN approved TINYINT(1) NOT NULL DEFAULT 0'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE article_comments ADD COLUMN author_name VARCHAR(80) NULL'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE article_comments ADD COLUMN parent_id CHAR(36) NULL'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE article_comments MODIFY user_id CHAR(36) NULL'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE article_likes ADD COLUMN guest_key VARCHAR(64) NULL'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE article_likes MODIFY user_id CHAR(36) NULL'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE round_comments ADD COLUMN createdAt DATETIME NULL'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE round_comments ADD COLUMN updatedAt DATETIME NULL'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE round_comments ADD COLUMN display_name VARCHAR(40) NULL'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE round_comments MODIFY user_id CHAR(36) NULL'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE accounting_entries ADD COLUMN attachment_url LONGTEXT NULL'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE competitions ADD COLUMN launched_at DATETIME NULL'); } catch (e) {}
    try { await sequelize.query("ALTER TABLE competitions ADD COLUMN scope_type ENUM('club','interclub','open') NOT NULL DEFAULT 'open'"); } catch (e) {}
    try { await sequelize.query('ALTER TABLE competitions ADD COLUMN club_id CHAR(36) NULL'); } catch (e) {}
    try { await sequelize.query("ALTER TABLE matchplay_championships ADD COLUMN scope_type ENUM('club','interclub','open') NOT NULL DEFAULT 'open'"); } catch (e) {}
    try { await sequelize.query('ALTER TABLE matchplay_championships ADD COLUMN club_id CHAR(36) NULL'); } catch (e) {}
    await sequelize.sync();
    await seedClubs();
    try { await sequelize.query('ALTER TABLE accounting_entries ADD COLUMN club_id CHAR(36) NULL'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE invoices ADD COLUMN club_id CHAR(36) NULL'); } catch (e) {}
    await promotePlatine();
    try { await migrateMatchPlay(); } catch (e) {}
    try { await sequelize.query('ALTER TABLE rounds ADD COLUMN under_investigation TINYINT(1) NOT NULL DEFAULT 0'); } catch (e) {}
    try { await sequelize.query('ALTER TABLE rounds ADD COLUMN investigation_note VARCHAR(255) NULL'); } catch (e) {}
    try { await sequelize.query("ALTER TABLE users MODIFY COLUMN role ENUM('joueur','admin','super_admin','platine_admin') NOT NULL DEFAULT 'joueur'"); } catch (e) {}
    try { await sequelize.query('ALTER TABLE rounds ADD COLUMN scoring_user_id CHAR(36) NULL'); } catch (e) {}
    console.log('Tables synchronisees');
    app.listen(PORT, () => {
      console.log('Serveur demarre sur le port', PORT);
    });
  } catch (err) {
    console.error('Impossible de demarrer:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

start();
