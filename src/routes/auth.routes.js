import express from 'express';
import multer from 'multer';
import {
  login,
  logout,
  refreshToken,
  getMe,
  changePassword,
  updateProfile,
  forgotPassword,
} from '../controllers/auth.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { getMyProfile } from '../controllers/employee.controller.js';





const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/login', login);
router.post('/refresh', refreshToken);
router.post('/logout', verifyJWT, logout);
//
router.get('/me', verifyJWT, getMe);
router.post('/change-password', verifyJWT, changePassword);
router.post('/forgot-password', forgotPassword);
router.put('/profile', verifyJWT, upload.single('profileImage'), updateProfile);

export default router;
