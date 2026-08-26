const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Competition = sequelize.define('Competition', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false,
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
    type: DataTypes.ENUM('open', 'closed'),
    defaultValue: 'open',
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
  launched_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  /** club = un club | interclub = trophée multi-clubs | open = ouvert à tous */
  scope_type: {
    type: DataTypes.ENUM('club', 'interclub', 'open'),
    allowNull: false,
    defaultValue: 'open',
  },
  /** Renseigné si scope_type = club */
  club_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
}, {
  tableName: 'competitions',
});

module.exports = Competition;
