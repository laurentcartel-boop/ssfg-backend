/**
 * Seed initial – Parcours Saint-Saëns + Super-admin de test
 */
require('dotenv').config();
const { sequelize, User, Course } = require('../models');

async function seed() {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ force: false });

    // Parcours Saint-Saëns – Par 71
    const [course] = await Course.findOrCreate({
      where: { short_name: 'Saint-Saëns' },
      defaults: {
        name: 'Golf de Saint-Saëns – FootGolf',
        short_name: 'Saint-Saëns',
        par_total: 71,
        holes_data: [
          { hole: 1, par: 4 },
          { hole: 2, par: 4 },
          { hole: 3, par: 4 },
          { hole: 4, par: 4 },
          { hole: 5, par: 5 },
          { hole: 6, par: 3 },
          { hole: 7, par: 4 },
          { hole: 8, par: 4 },
          { hole: 9, par: 5 },
          { hole: 10, par: 3 },
          { hole: 11, par: 5 },
          { hole: 12, par: 4 },
          { hole: 13, par: 3 },
          { hole: 14, par: 3 },
          { hole: 15, par: 4 },
          { hole: 16, par: 5 },
          { hole: 17, par: 4 },
          { hole: 18, par: 3 },
        ],
        is_active: true,
      },
    });

    // Si le parcours existait déjà avec un mauvais par_total, on le met à jour
    if (course.par_total !== 71) {
      await course.update({
        par_total: 71,
        holes_data: [
          { hole: 1, par: 4 }, { hole: 2, par: 4 }, { hole: 3, par: 4 },
          { hole: 4, par: 4 }, { hole: 5, par: 5 }, { hole: 6, par: 3 },
          { hole: 7, par: 4 }, { hole: 8, par: 4 }, { hole: 9, par: 5 },
          { hole: 10, par: 3 }, { hole: 11, par: 5 }, { hole: 12, par: 4 },
          { hole: 13, par: 3 }, { hole: 14, par: 3 }, { hole: 15, par: 4 },
          { hole: 16, par: 5 }, { hole: 17, par: 4 }, { hole: 18, par: 3 },
        ],
      });
    }
    console.log('✅ Parcours:', course.short_name, '- Par', course.par_total);

    // Super-admin de test (à changer en production)
    const [admin] = await User.findOrCreate({
      where: { email: 'admin@ssfg.fr' },
      defaults: {
        email: 'admin@ssfg.fr',
        password_hash: 'ChangeMe123!', // sera hashé par le hook
        first_name: 'Super',
        last_name: 'Admin',
        role: 'super_admin',
        index_value: 1.0,
        gender: 'M',
        is_active: true,
      },
    });
    console.log('✅ Super-admin créé:', admin.email);

    console.log('\nSeed terminé.');
    process.exit(0);
  } catch (err) {
    console.error('Erreur seed:', err);
    process.exit(1);
  }
}

seed();
