const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ArticleComment = sequelize.define(
  'ArticleComment',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    article_id: { type: DataTypes.UUID, allowNull: false },
    user_id: { type: DataTypes.UUID, allowNull: true },
    author_name: { type: DataTypes.STRING(80), allowNull: true },
    body: { type: DataTypes.STRING(500), allowNull: false },
    hidden: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    approved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    parent_id: { type: DataTypes.UUID, allowNull: true },
  },
  { tableName: 'article_comments' }
);

module.exports = ArticleComment;
