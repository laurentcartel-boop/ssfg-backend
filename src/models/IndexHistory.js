const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const IndexHistory = sequelize.define('IndexHistory', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  old_index: {
    type: DataTypes.DECIMAL(5, 1),
    allowNull: false,
  },
  new_index: {
    type: DataTypes.DECIMAL(5, 1),
    allowNull: false,
  },
  change: {
    type: DataTypes.DECIMAL(5, 1),
    allowNull: false,
  },
  reason: {
    type: DataTypes.ENUM('round', 'inactivity', 'manual'),
    allowNull: false,
  },
  round_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
}, {
  tableName: 'index_history',
  updatedAt: false,
});

module.exports = IndexHistory;
