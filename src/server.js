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
app.use('/api/competitions', require('./routes/competitions'));
app.use('/api/articles', require('./routes/articles'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/accounting', require('./routes/accounting'));
app.use('/api/matchplay', require('./routes/matchplay'));

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
      
    try {
      await sequelize.query(
        'ALTER TABLE accounting_entries ADD COLUMN attachment_url LONGTEXT NULL'
      );
      console.log('➕ accounting_entries.attachment_url');
    } catch (e) {}

    await sequelize.sync();
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
