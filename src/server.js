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
      await sequelize.query(`ALTER TABLE matchplay_matches DROP FOREIGN KEY \`${name}\``);
    } catch (e) {}
  }
  try { await sequelize.query('ALTER TABLE matchplay_matches MODIFY player_a_id CHAR(36) NULL'); } catch (e) {}
  try { await sequelize.query('ALTER TABLE matchplay_matches MODIFY player_b_id CHAR(36) NULL'); } catch (e) {}
  try {
    await sequelize.query("ALTER TABLE matchplay_matches ADD COLUMN is_bye TINYINT(1) NOT NULL DEFAULT 0");
  } catch (e) {}
}

async function promotePlatine() {
  const { User } = require('./models');
  const raw = process.env.PLATINE_EMAILS || process.env.PLATINE_EMAIL || '';
  const emails = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) return;
  for (const email of emails) {
    const user = await User.findOne({ where: { email } });
    if (user && user.role !== 'platine_admin') {
      await user.update({ role: 'platine_admin' });
      console.log('Admin Platine :', email);
    }
  }
}

async function seedClubs() {
  const { Club, User } = require('./models');
  try {
    await sequelize.query('ALTER TABLE users ADD COLUMN club_id CHAR(36) NULL');
  } catch (e) {}
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
  if (ssfg) {
    await User.update({ club_id: ssfg.id }, { where: { club_id: null } });
  }
}

async function start() {
  try {
    await sequelize.authenticate();
    console.log('Connexion base de donnees OK');
    try {
      const [cols] = await sequelize.query("SHOW COLUMNS FROM round_comments LIKE 'createdAt'");
      if (!cols.length) {
        await sequelize.query('DROP TABLE IF EXISTS round_comments');
      }
    } catch (e) {}
    const alters = [
      "ALTER TABLE accounting_entries ADD COLUMN attachment_url LONGTEXT NULL",
      "ALTER TABLE competitions ADD COLUMN launched_at DATETIME NULL",
      "ALTER TABLE competitions ADD COLUMN scope_type ENUM('club','interclub','open') NOT NULL DEFAULT 'open'",
      "ALTER TABLE competitions ADD COLUMN club_id CHAR(36) NULL",
      "ALTER TABLE matchplay_championships ADD COLUMN scope_type ENUM('club','interclub','open') NOT NULL DEFAULT 'open'",
      "ALTER TABLE matchplay_championships ADD COLUMN club_id CHAR(36) NULL",
    ];
    for (const sql of alters) {
      try { await sequelize.query(sql); } catch (e) {}
    }
    try {
      await sequelize.sync();
      await seedClubs();
      try { await sequelize.query('ALTER TABLE accounting_entries ADD COLUMN club_id CHAR(36) NULL'); } catch (e) {}
      try { await sequelize.query('ALTER TABLE invoices ADD COLUMN club_id CHAR(36) NULL'); } catch (e) {}
      try {
        const [ssfg] = await sequelize.query("SELECT id FROM clubs WHERE code = 'SSFG' LIMIT 1");
        const sid = ssfg && ssfg[0] && ssfg[0].id;
        if (sid) {
          await sequelize.query('UPDATE accounting_entries SET club_id = :sid WHERE club_id IS NULL', { replacements: { sid } });
          await sequelize.query('UPDATE invoices SET club_id = :sid WHERE club_id IS NULL', { replacements: { sid } });
        }
      } catch (e) {}
      await promotePlatine();
    } catch (syncErr) {
      console.error('sequelize.sync:', syncErr);
      throw syncErr;
    }
    try { await migrateMatchPlay(); } catch (e) {}
    const more = [
      'ALTER TABLE marcassins_teams ADD COLUMN morning_round_id CHAR(36) NULL',
      'ALTER TABLE marcassins_teams ADD COLUMN afternoon_round_id CHAR(36) NULL',
      'ALTER TABLE rounds ADD COLUMN under_investigation TINYINT(1) NOT NULL DEFAULT 0',
      'ALTER TABLE rounds ADD COLUMN investigation_note VARCHAR(255) NULL',
      "ALTER TABLE users MODIFY COLUMN role ENUM('joueur','admin','super_admin','platine_admin') NOT NULL DEFAULT 'joueur'",
      'ALTER TABLE rounds ADD COLUMN scoring_user_id CHAR(36) NULL',
      'ALTER TABLE article_comments ADD COLUMN approved TINYINT(1) NOT NULL DEFAULT 0',
      'ALTER TABLE article_comments ADD COLUMN author_name VARCHAR(80) NULL',
      'ALTER TABLE article_comments MODIFY user_id CHAR(36) NULL',
    ];
    for (const sql of more) {
      try { await sequelize.query(sql); } catch (e) {}
    }
    try {
      await sequelize.query('UPDATE article_comments SET approved = 1 WHERE user_id IS NOT NULL');
    } catch (e) {}
    app.listen(PORT, () => {
      console.log('Serveur demarre sur le port', PORT);
    });
  } catch (err) {
    console.error('Impossible de demarrer:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

start();
