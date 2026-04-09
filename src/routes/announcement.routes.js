import { Router } from 'express';
import {
  createAnnouncement,
  getAllAnnouncements,
  getMyAnnouncements,
  getUnreadCount,
  markAsRead,
  updateAnnouncement,
  deleteAnnouncement,
} from '../controllers/announcement.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';

const router = Router();

// All routes require authentication
router.use(verifyJWT);

// ── ADMIN / HR ROUTES ──
const ADMIN_ROLES = ['SuperUser', 'HR', 'Director', 'VP', 'GM', 'Manager'];

router.post('/', authorizeRoles(...ADMIN_ROLES), createAnnouncement);
router.get('/', authorizeRoles(...ADMIN_ROLES), getAllAnnouncements);
router.patch('/:id', authorizeRoles(...ADMIN_ROLES), updateAnnouncement);
router.delete('/:id', authorizeRoles(...ADMIN_ROLES), deleteAnnouncement);

// ── EMPLOYEE ROUTES ──
router.get('/my', getMyAnnouncements);
router.get('/unread-count', getUnreadCount);
router.patch('/:id/read', markAsRead);

export default router;
