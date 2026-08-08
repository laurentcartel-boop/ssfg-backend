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
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'FootGolf Scoring SSFG', version: '1.0.0' });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/rounds', require('./routes/rounds'));
app.use('/api/rankings', require('./routes/rankings'));
app.use('/api/competitions', require('./routes/competitions'));
app.use('/api/articles', require('./routes/articles'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Erreur serveur',
  });
});

async function start() {
  try {
    await sequelize.authenticate();
    console.log('OK connexion BDD');

    await sequelize.sync({ alter: true });
    console.log('OK tables');

    app.listen(PORT, () => {
      console.log('Serveur port ' + PORT);
    });
  } catch (err) {
    console.error('Impossible de demarrer');
    console.error(err);
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

start();
