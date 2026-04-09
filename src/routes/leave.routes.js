import { Router } from 'express';
import {
  applyLeave,
  getMyLeaves,
  getPendingLeaves,
  getAllLeaves,
  getLeaveById,
  approveLeave,
  rejectLeave,
  cancelLeave,
  getLeaveStats,
  accrueMonthlyLeaves,
} from '../controllers/leave.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';

const router = Router();

// All routes require authentication
router.use(verifyJWT);

// ── STATS (admin/HR) ──
router.get(
  '/stats',
  authorizeRoles('SuperUser', 'HR', 'GM', 'VP', 'Director'),
  getLeaveStats
);

// ── MY LEAVES (any authenticated user) ──
router.get('/my', getMyLeaves);

// ── PENDING LEAVES (approvers only) ──
router.get(
  '/pending',
  authorizeRoles('SuperUser', 'HR', 'GM', 'VP', 'Director', 'Manager'),
  getPendingLeaves
);

// ── ALL LEAVES (admin view) ──
router.get(
  '/all',
  authorizeRoles('SuperUser', 'HR', 'GM', 'VP', 'Director'),
  getAllLeaves
);

// ── APPLY FOR LEAVE ──
router.post('/apply', applyLeave);

// ── LEAVE BY ID ──
router.get('/:id', getLeaveById);

// ── APPROVE ──
router.patch(
  '/:id/approve',
  authorizeRoles('SuperUser', 'HR', 'GM', 'VP', 'Director', 'Manager'),
  approveLeave
);

// ── REJECT ──
router.patch(
  '/:id/reject',
  authorizeRoles('SuperUser', 'HR', 'GM', 'VP', 'Director', 'Manager'),
  rejectLeave
);

// ── CANCEL (owner or admin) ──
router.patch('/:id/cancel', cancelLeave);

// ── ACCRUAL (Admin/HR only) ──
router.post('/accrue-monthly', authorizeRoles('SuperUser', 'HR', 'Director'), accrueMonthlyLeaves);

export default router;
