const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Course = sequelize.define('Course', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  short_name: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  par_total: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  holes_data: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: 'Array of {hole: number, par: number}',
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  tableName: 'courses',
});

module.exports = Course;
