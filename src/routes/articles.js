const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/articleController');
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');

// Public
router.get('/', ctrl.listPublic);

// Admin list (before :id)
router.get('/admin/all', authenticate, requireRole('admin', 'super_admin', 'platine_admin'), ctrl.listAll);
router.get('/admin/pending-comments', authenticate, ctrl.listPendingComments);
router.post('/admin/comments/:commentId', authenticate, ctrl.moderateComment);

router.get('/:id', (req, res, next) => {
  // optional auth for drafts
  const header = req.headers.authorization;
  if (header) return authenticate(req, res, () => ctrl.getOne(req, res, next));
  return ctrl.getOne(req, res, next);
});

router.post('/', authenticate, requireRole('admin', 'super_admin', 'platine_admin'), ctrl.create);
router.put('/:id', authenticate, requireRole('admin', 'super_admin', 'platine_admin'), ctrl.update);
router.delete('/:id', authenticate, requireRole('admin', 'super_admin', 'platine_admin'), ctrl.remove);

router.get('/:id/engagement', optionalAuth, ctrl.getEngagement);
router.post('/:id/like', optionalAuth, ctrl.toggleLike);
router.post('/:id/comments', optionalAuth, ctrl.addComment);

module.exports = router;
