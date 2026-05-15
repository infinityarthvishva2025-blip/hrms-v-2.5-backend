import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import {
  applyResignation,
  getMyResignations,
  getPendingApprovals,
  getAllResignations,
  takeAction,
  updateResignation,
  getResignationById
} from '../controllers/resignation.controller.js';

const router = Router();

// Require auth for all routes
router.use(verifyJWT);

// Employee routes
router.route('/my').get(getMyResignations);
router.route('/apply').post(applyResignation);
router.route('/:id/update').put(updateResignation); // For sent back

// Approver routes
router.route('/pending').get(getPendingApprovals);
router.route('/all').get(getAllResignations); // Usually restricted to HR/SuperUser in frontend
router.route('/:id').get(getResignationById);
router.route('/:id/action').put(takeAction);

export default router;
