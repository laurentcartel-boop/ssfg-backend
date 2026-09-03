require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { sequelize } = require('./models');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS – en production, restreindre aux domaines autorisés
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : true; // true = toutes origines (dev)

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '15mb' }));

// Routes
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
  console.warn('⚠️ Route Marcassins absente:', e.message);
}

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Erreur serveur',
  });
});

async function migrateMatchPlay() {
  const qi = sequelize.getQueryInterface();
  const [tables] = await sequelize.query("SHOW TABLES LIKE 'matchplay_matches'");
  if (!tables.length) return;

  // Drop foreign keys on player columns (bloque le NULL)
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
      console.log('FK dropped:', name);
    } catch (e) {
      console.warn('FK drop skip:', name, e.message);
    }
  }

  // Nullable players + is_bye
  try {
    await sequelize.query('ALTER TABLE matchplay_matches MODIFY player_a_id CHAR(36) NULL');
  } catch (e) {
    console.warn('player_a_id:', e.message);
  }
  try {
    await sequelize.query('ALTER TABLE matchplay_matches MODIFY player_b_id CHAR(36) NULL');
  } catch (e) {
    console.warn('player_b_id:', e.message);
  }
  try {
    await sequelize.query(
      "ALTER TABLE matchplay_matches ADD COLUMN is_bye TINYINT(1) NOT NULL DEFAULT 0"
    );
  } catch (e) {
    // already exists
  }
}



async function promotePlatine() {
  const { User } = require('./models');
  const raw = process.env.PLATINE_EMAILS || process.env.PLATINE_EMAIL || '';
  const emails = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!emails.length) {
    console.log('ℹ️ PLATINE_EMAILS non défini — aucun compte promu');
    return;
  }
  for (const email of emails) {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      console.warn('⚠️ PLATINE: compte introuvable', email);
      continue;
    }
    if (user.role !== 'platine_admin') {
      await user.update({ role: 'platine_admin' });
      console.log('✅ Admin Platine :', email);
    }
  }
}

async function seedClubs() {
  const { Club, User } = require('./models');

  // Colonne club_id (sync sans alter ne l’ajoute pas sur table users existante)
  try {
    await sequelize.query(
      'ALTER TABLE users ADD COLUMN club_id CHAR(36) NULL'
    );
    console.log('➕ users.club_id');
  } catch (e) {
    // déjà présente
  }

  const defaults = [
    { code: 'SSFG', name: 'Saint-Saëns FootGolf', short_name: 'SSFG', sort_order: 1 },
    { code: 'AFG', name: 'AFG', short_name: 'AFG', sort_order: 2 },
    { code: 'HAC', name: 'HAC FootGolf', short_name: 'HAC', sort_order: 3 },
    { code: 'RMFC', name: 'RMFC', short_name: 'RMFC', sort_order: 4 },
    { code: 'NONE', name: 'Sans club', short_name: 'Sans club', sort_order: 99 },
  ];
  for (const d of defaults) {
    try {
      await Club.findOrCreate({
        where: { code: d.code },
        defaults: { ...d, is_active: true },
      });
    } catch (e) {
      console.warn('seed club', d.code, e.message);
    }
  }
  const count = await Club.count();
  console.log(`✅ Clubs en base: ${count}`);
  const ssfg = await Club.findOne({ where: { code: 'SSFG' } });
  if (ssfg) {
    const [n] = await User.update(
      { club_id: ssfg.id },
      { where: { club_id: null } }
    );
    if (n) console.log(`➕ ${n} joueur(s) rattachés à SSFG`);
  }
  console.log('✅ Clubs seed OK');
}

async function start() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connexion base de données OK');

    // Créer les tables manquantes sans alter (évite "Too many keys" MySQL)
    // Si round_comments a été créée incomplète (sans timestamps), on la recrée
    try {
      const [cols] = await sequelize.query(
        "SHOW COLUMNS FROM round_comments LIKE 'createdAt'"
      );
      if (!cols.length) {
        await sequelize.query('DROP TABLE IF EXISTS round_comments');
        console.log('♻️  round_comments recreée (timestamps manquants)');
      } else {
        // ajouter display_name / user_id nullable si besoin
        try {
          await sequelize.query(
            'ALTER TABLE round_comments ADD COLUMN display_name VARCHAR(40) NULL'
          );
        } catch (e) {}
        try {
          await sequelize.query(
            'ALTER TABLE round_comments MODIFY user_id CHAR(36) NULL'
          );
        } catch (e) {}
      }
    } catch (e) {
      // table absente → sync la créera
    }

    try {
      await sequelize.query(
        'ALTER TABLE accounting_entries ADD COLUMN attachment_url LONGTEXT NULL'
      );
      console.log('➕ accounting_entries.attachment_url');
    } catch (e) {}
    try {
      await sequelize.query(
        'ALTER TABLE competitions ADD COLUMN launched_at DATETIME NULL'
      );
      console.log('➕ competitions.launched_at');
    } catch (e) {}
    try {
      await sequelize.query(
        "ALTER TABLE competitions ADD COLUMN scope_type ENUM('club','interclub','open') NOT NULL DEFAULT 'open'"
      );
      console.log('➕ competitions.scope_type');
    } catch (e) {}
    try {
      await sequelize.query(
        'ALTER TABLE competitions ADD COLUMN club_id CHAR(36) NULL'
      );
      console.log('➕ competitions.club_id');
    } catch (e) {}
    try {
      await sequelize.query(
        "ALTER TABLE matchplay_championships ADD COLUMN scope_type ENUM('club','interclub','open') NOT NULL DEFAULT 'open'"
      );
      console.log('➕ matchplay scope_type');
    } catch (e) {}
    try {
      await sequelize.query(
        'ALTER TABLE matchplay_championships ADD COLUMN club_id CHAR(36) NULL'
      );
      console.log('➕ matchplay club_id');
    } catch (e) {}

    try {
      await sequelize.sync();
      await seedClubs();
      try {
        await sequelize.query(
          'ALTER TABLE accounting_entries ADD COLUMN club_id CHAR(36) NULL'
        );
        console.log('➕ accounting club_id');
      } catch (e) {}
      try {
        const [ssfg] = await sequelize.query(
          "SELECT id FROM clubs WHERE code = 'SSFG' LIMIT 1"
        );
        const sid = ssfg && ssfg[0] && ssfg[0].id;
        if (sid) {
          await sequelize.query(
            'UPDATE accounting_entries SET club_id = :sid WHERE club_id IS NULL',
            { replacements: { sid } }
          );
          console.log('✅ écritures existantes → SSFG');
        }
      } catch (e) {
        console.warn('migrate accounting club', e.message);
      }
      await promotePlatine();
      console.log('✅ sequelize.sync OK');
    } catch (syncErr) {
      console.error('❌ sequelize.sync:', syncErr);
      throw syncErr;
    }
    try {
      await migrateMatchPlay();
    } catch (migErr) {
      console.warn('⚠️ migrateMatchPlay:', migErr.message || migErr);
    }
    try {
      await sequelize.query(
        'ALTER TABLE marcassins_teams ADD COLUMN morning_round_id CHAR(36) NULL'
      );
    } catch (e) {}
    try {
      await sequelize.query(
        'ALTER TABLE marcassins_teams ADD COLUMN afternoon_round_id CHAR(36) NULL'
      );
    } catch (e) {}
    try {
      await sequelize.query(
        'ALTER TABLE rounds ADD COLUMN under_investigation TINYINT(1) NOT NULL DEFAULT 0'
      );
    } catch (e) {}
    try {
      await sequelize.query(
        'ALTER TABLE rounds ADD COLUMN investigation_note VARCHAR(255) NULL'
      );
    } catch (e) {}
    try {
      await sequelize.query(
        "ALTER TABLE users MODIFY COLUMN role ENUM('joueur','admin','super_admin','platine_admin') NOT NULL DEFAULT 'joueur'"
      );
    } catch (e) {
      console.warn('ALTER role', e.message);
    }
    try {
      await sequelize.query(
        'ALTER TABLE rounds ADD COLUMN scoring_user_id CHAR(36) NULL'
      );
    } catch (e) {}
    console.log('✅ Tables synchronisées');

    app.listen(PORT, () => {
      console.log(`🚀 Serveur démarré sur le port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Impossible de démarrer:', err && err.message ? err.message : err);
    if (err && err.stack) console.error(err.stack);
    if (err && err.parent) console.error('SQL:', err.parent.message || err.parent);
    process.exit(1);
  }
}


start();
