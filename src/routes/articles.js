const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/articleController');
const { authenticate, requireRole } = require('../middleware/auth');

// Public
router.get('/', ctrl.listPublic);

// Admin list (before :id)
router.get('/admin/all', authenticate, requireRole('admin', 'super_admin'), ctrl.listAll);

router.get('/:id', (req, res, next) => {
  // optional auth for drafts
  const header = req.headers.authorization;
  if (header) return authenticate(req, res, () => ctrl.getOne(req, res, next));
  return ctrl.getOne(req, res, next);
});

router.post('/', authenticate, requireRole('admin', 'super_admin'), ctrl.create);
router.put('/:id', authenticate, requireRole('admin', 'super_admin'), ctrl.update);
router.delete('/:id', authenticate, requireRole('admin', 'super_admin'), ctrl.remove);

router.get('/:id/engagement', (req, res, next) => {
  const header = req.headers.authorization;
  if (header) return authenticate(req, res, () => ctrl.getEngagement(req, res, next));
  return ctrl.getEngagement(req, res, next);
});
router.post('/:id/like', authenticate, ctrl.toggleLike);
router.post('/:id/comments', authenticate, ctrl.addComment);

module.exports = router;
