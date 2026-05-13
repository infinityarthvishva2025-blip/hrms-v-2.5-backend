import { Router } from 'express';
import { getHRDashboardStats } from '../controllers/dashboard.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';

const router = Router();

// Only HR and other management roles should access these stats
router.route('/hr-stats').get(
    verifyJWT, 
    authorizeRoles('SuperUser', 'HR', 'Director', 'VP', 'GM'), 
    getHRDashboardStats
);

export default router;
