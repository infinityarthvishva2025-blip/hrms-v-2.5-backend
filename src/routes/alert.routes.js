import express from 'express';
import {
  getActiveAlert,
  createAlert,
  updateAlert,
  deleteAlert,
} from '../controllers/alert.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';

const router = express.Router();

// ── PUBLIC ──
router.get('/', getActiveAlert);

// ── ADMIN ONLY ──
router.post('/', verifyJWT, authorizeRoles('SuperUser', 'HR', 'GM', 'VP', 'Director'), createAlert);
router.put('/:id', verifyJWT, authorizeRoles('SuperUser', 'HR', 'GM', 'VP', 'Director'), updateAlert);
router.delete('/:id', verifyJWT, authorizeRoles('SuperUser', 'HR', 'GM', 'VP', 'Director'), deleteAlert);

export default router;
