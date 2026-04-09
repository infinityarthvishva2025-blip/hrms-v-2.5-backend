import express from 'express';
import { 
  generatePayroll, 
  generateAllPayroll,
  getPayrollList, 
  getSalarySlip 
} from '../controllers/payroll.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles, MANAGEMENT_ROLES, ALL_ROLES } from '../middleware/role.middleware.js';

const router = express.Router();

// ── PROTECTED ALL ──
router.use(verifyJWT);

// ── ADMIN / HR ONLY ──
router.post('/generate', authorizeRoles('SuperUser', 'HR', 'Director'), generatePayroll);
router.post('/generate-all', authorizeRoles('SuperUser', 'HR', 'Director'), generateAllPayroll);
router.get('/list', authorizeRoles(...ALL_ROLES), getPayrollList);

// ── INDIVIDUAL ACCESS ──
router.get('/salary-slip/:id', getSalarySlip);

export default router;
