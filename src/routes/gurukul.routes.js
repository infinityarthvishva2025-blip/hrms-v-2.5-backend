import express from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles, MANAGEMENT_ROLES } from '../middleware/role.middleware.js';
import { upload } from '../middleware/upload.middleware.js';
import {
  getAllVideos,
  getVideoById,
  createVideo,
  updateVideo,
  deleteVideo,
} from '../controllers/video.controller.js';
import {
  getSectionsByVideo,
  createSection,
  updateSection,
  deleteSection,
} from '../controllers/section.controller.js';
import {
  getSubsectionsBySection,
  createSubsection,
  updateSubsection,
  deleteSubsection,
} from '../controllers/subsection.controller.js';

const router = express.Router();

// All routes require authentication
router.use(verifyJWT);

// ──────────────────────────────────────────────────────────────
// Video Routes
// ──────────────────────────────────────────────────────────────
router.get('/videos', getAllVideos);                               // All users
router.get('/videos/:id', getVideoById);                           // All users
router.post('/videos', authorizeRoles(...MANAGEMENT_ROLES), upload.single('video'), createVideo); // Admin
router.put('/videos/:id', authorizeRoles(...MANAGEMENT_ROLES), upload.single('video'), updateVideo); // Admin
router.delete('/videos/:id', authorizeRoles(...MANAGEMENT_ROLES), deleteVideo); // Admin

// ──────────────────────────────────────────────────────────────
// Section Routes (nested under video)
// ──────────────────────────────────────────────────────────────
router.get('/videos/:videoId/sections', getSectionsByVideo);      // All users
router.post('/videos/:videoId/sections', authorizeRoles(...MANAGEMENT_ROLES), createSection); // Admin
router.put('/sections/:id', authorizeRoles(...MANAGEMENT_ROLES), updateSection); // Admin
router.delete('/sections/:id', authorizeRoles(...MANAGEMENT_ROLES), deleteSection); // Admin

// ──────────────────────────────────────────────────────────────
// Subsection Routes (nested under section)
// ──────────────────────────────────────────────────────────────
router.get('/sections/:sectionId/subsections', getSubsectionsBySection); // All users
router.post('/sections/:sectionId/subsections', authorizeRoles(...MANAGEMENT_ROLES), createSubsection); // Admin
router.put('/subsections/:id', authorizeRoles(...MANAGEMENT_ROLES), updateSubsection); // Admin
router.delete('/subsections/:id', authorizeRoles(...MANAGEMENT_ROLES), deleteSubsection); // Admin

export default router;