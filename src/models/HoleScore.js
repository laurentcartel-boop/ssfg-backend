const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const HoleScore = sequelize.define('HoleScore', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  round_player_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  hole_number: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 18 },
  },
  score: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1 },
  },
  par: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  updated_by: {
    type: DataTypes.UUID,
    allowNull: true,
  },
}, {
  tableName: 'hole_scores',
  updatedAt: 'updated_at',
  createdAt: false,
});

module.exports = HoleScore;
