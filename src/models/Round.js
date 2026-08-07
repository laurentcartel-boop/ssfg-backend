const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Round = sequelize.define('Round', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  type: {
    type: DataTypes.ENUM('libre', 'competition', 'entrainement'),
    allowNull: false,
    defaultValue: 'libre',
  },
  course_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('draft', 'in_progress', 'closed'),
    defaultValue: 'draft',
    allowNull: false,
  },
  created_by: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  closed_by: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  closed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  competition_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
}, {
  tableName: 'rounds',
});

module.exports = Round;
