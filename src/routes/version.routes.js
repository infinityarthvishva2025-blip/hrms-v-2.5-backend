import express from 'express';
import {
  checkVersion,
  createAppVersion,
  updateAppVersion,
  deleteAppVersion,
} from '../controllers/version.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';

const router = express.Router();

// ── PUBLIC ──
router.post('/check', checkVersion);

// ── ADMIN ONLY ──
router.post('/', verifyJWT, authorizeRoles('SuperUser', 'HR', 'GM', 'VP', 'Director'), createAppVersion);
router.put('/:id', verifyJWT, authorizeRoles('SuperUser', 'HR', 'GM', 'VP', 'Director'), updateAppVersion);
router.delete('/:id', verifyJWT, authorizeRoles('SuperUser', 'HR', 'GM', 'VP', 'Director'), deleteAppVersion);

export default router;
