const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RoundPlayer = sequelize.define('RoundPlayer', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  round_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  starting_index: {
    type: DataTypes.DECIMAL(5, 1),
    allowNull: false,
  },
  total_score: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  score_to_par: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  net_score: {
    type: DataTypes.DECIMAL(5, 1),
    allowNull: true,
  },
  index_change: {
    type: DataTypes.DECIMAL(5, 1),
    allowNull: true,
  },
  new_index: {
    type: DataTypes.DECIMAL(5, 1),
    allowNull: true,
  },
  dnf: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
}, {
  tableName: 'round_players',
});

module.exports = RoundPlayer;
