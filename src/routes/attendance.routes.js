import { Router } from 'express';
import {
  checkIn,
  checkOut,
  getTodayStatus,
  getMySummary,
  getAdminAttendanceList,
  markReportAsRead,
  requestCorrection,
  approveCorrection,
  rejectCorrection,
  getPendingCorrections,
  getAttendanceByDate,
} from '../controllers/attendance.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles, MANAGEMENT_ROLES } from '../middleware/role.middleware.js';

const router = Router();

// All authenticated routes
router.use(verifyJWT);

router.post('/check-in', checkIn);
router.post('/check-out', checkOut);
router.get('/today', getTodayStatus);
router.get('/my-summary', getMySummary);

// Admin / Management only
router.get('/admin', authorizeRoles(...MANAGEMENT_ROLES, 'Manager'), getAdminAttendanceList);
router.patch('/mark-read/:id', authorizeRoles(...MANAGEMENT_ROLES, 'Manager'), markReportAsRead);

// ── CORRECTION ROUTES ──
router.post('/correction/:id', requestCorrection);
router.get('/corrections/pending', authorizeRoles(...MANAGEMENT_ROLES, 'Manager'), getPendingCorrections);
router.patch('/correction-approve/:id', authorizeRoles(...MANAGEMENT_ROLES, 'Manager'), approveCorrection);
router.patch('/correction-reject/:id', authorizeRoles(...MANAGEMENT_ROLES, 'Manager'), rejectCorrection);


// -------  attendance details for the selecte date
router.get('/employee-attendance', authorizeRoles(...MANAGEMENT_ROLES, 'Manager'), getAttendanceByDate);


export default router;
