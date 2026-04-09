import express from 'express';
import { 
  getAllHolidays, 
  createHoliday, 
  updateHoliday, 
  deleteHoliday 
} from '../controllers/holiday.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';

const router = express.Router();

// ── PROTECTED ALL ──
router.use(verifyJWT);

// ── EMPLOYEE VISIBILITY ──
router.get('/', getAllHolidays);

// ── MANAGEMENT ONLY ──
router.post('/', authorizeRoles('SuperUser', 'HR', 'GM', 'VP', 'Director'), createHoliday);
router.put('/:id', authorizeRoles('SuperUser', 'HR', 'GM', 'VP', 'Director'), updateHoliday);
router.delete('/:id', authorizeRoles('SuperUser', 'HR', 'GM', 'VP', 'Director'), deleteHoliday);

export default router;
