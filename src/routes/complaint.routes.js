import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import {
  submitComplaint,
  getMyComplaints,
  getDirectorComplaints,
  getComplaintById,
  directorAction
} from '../controllers/complaint.controller.js';

const router = Router();

// All routes require authentication
router.use(verifyJWT);

// Employee (allowed roles) routes
router.route('/apply').post(submitComplaint);
router.route('/my').get(getMyComplaints);

// Director routes
router.route('/director').get(getDirectorComplaints);
router.route('/:id').get(getComplaintById);
router.route('/:id/action').put(directorAction);

export default router;