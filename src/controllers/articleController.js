const { Article, User } = require('../models');

/** GET /api/articles — public : uniquement publiés */
async function listPublic(req, res) {
  try {
    const articles = await Article.findAll({
      where: { published: true },
      include: [
        { model: User, as: 'author', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['published_at', 'DESC'], ['created_at', 'DESC']],
      limit: 50,
    });
    res.json({ articles });
  } catch (err) {
    console.error('listPublic articles:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/** GET /api/articles/:id — public si publié, sinon admin */
async function getOne(req, res) {
  try {
    const article = await Article.findByPk(req.params.id, {
      include: [
        { model: User, as: 'author', attributes: ['id', 'first_name', 'last_name'] },
      ],
    });
    if (!article) return res.status(404).json({ error: 'Article introuvable' });
    if (!article.published) {
      const role = req.user?.role;
      if (!role || !['admin', 'super_admin'].includes(role)) {
        return res.status(404).json({ error: 'Article introuvable' });
      }
    }
    res.json({ article });
  } catch (err) {
    console.error('getOne article:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/** GET /api/articles/admin/all — admin : tous */
async function listAll(req, res) {
  try {
    const articles = await Article.findAll({
      include: [
        { model: User, as: 'author', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['created_at', 'DESC']],
      limit: 100,
    });
    res.json({ articles });
  } catch (err) {
    console.error('listAll articles:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/** POST /api/articles — admin */
async function create(req, res) {
  try {
    const { title, body, excerpt, image_url, published } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: 'Titre et texte obligatoires' });
    }
    const isPub = Boolean(published);
    const article = await Article.create({
      title: title.trim(),
      body: body.trim(),
      excerpt: excerpt ? excerpt.trim() : title.trim().slice(0, 200),
      image_url: image_url || null,
      published: isPub,
      published_at: isPub ? new Date() : null,
      created_by: req.user.id,
    });
    res.status(201).json({ article, message: isPub ? 'Article publié' : 'Brouillon enregistré' });
  } catch (err) {
    console.error('create article:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/** PUT /api/articles/:id — admin */
async function update(req, res) {
  try {
    const article = await Article.findByPk(req.params.id);
    if (!article) return res.status(404).json({ error: 'Article introuvable' });

    const { title, body, excerpt, image_url, published } = req.body;
    const data = {};
    if (title != null) data.title = title.trim();
    if (body != null) data.body = body.trim();
    if (excerpt != null) data.excerpt = excerpt.trim();
    if (image_url !== undefined) data.image_url = image_url || null;
    if (published !== undefined) {
      data.published = Boolean(published);
      if (data.published && !article.published_at) data.published_at = new Date();
      if (!data.published) data.published_at = null;
    }
    await article.update(data);
    res.json({ article, message: 'Article mis à jour' });
  } catch (err) {
    console.error('update article:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/** DELETE /api/articles/:id — admin */
async function remove(req, res) {
  try {
    const article = await Article.findByPk(req.params.id);
    if (!article) return res.status(404).json({ error: 'Article introuvable' });
    await article.destroy();
    res.json({ message: 'Article supprimé' });
  } catch (err) {
    console.error('delete article:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}


async function engagement(articleId, userId) {
  const { ArticleLike, ArticleComment, User } = require('../models');
  const likes = await ArticleLike.count({ where: { article_id: articleId } });
  const liked = userId
    ? Boolean(await ArticleLike.findOne({ where: { article_id: articleId, user_id: userId } }))
    : false;
  const comments = await ArticleComment.findAll({
    where: { article_id: articleId, hidden: false },
    include: [{ model: User, as: 'user', attributes: ['id', 'first_name', 'last_name'] }],
    order: [['createdAt', 'ASC']],
    limit: 100,
  });
  return { likes_count: likes, liked, comments };
}

async function getEngagement(req, res) {
  try {
    const data = await engagement(req.params.id, req.user?.id);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function toggleLike(req, res) {
  try {
    const { ArticleLike } = require('../models');
    const article_id = req.params.id;
    const user_id = req.user.id;
    const existing = await ArticleLike.findOne({ where: { article_id, user_id } });
    if (existing) await existing.destroy();
    else await ArticleLike.create({ article_id, user_id });
    const data = await engagement(article_id, user_id);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function addComment(req, res) {
  try {
    const { ArticleComment } = require('../models');
    const body = String(req.body.body || '').trim();
    if (body.length < 2) return res.status(400).json({ error: 'Commentaire trop court' });
    if (body.length > 500) return res.status(400).json({ error: 'Max 500 caractères' });
    await ArticleComment.create({
      article_id: req.params.id,
      user_id: req.user.id,
      body,
    });
    const data = await engagement(req.params.id, req.user.id);
    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

module.exports = {
  listPublic,
  getOne,
  listAll,
  create,
  update,
  remove,
  getEngagement,
  toggleLike,
  addComment,
};

