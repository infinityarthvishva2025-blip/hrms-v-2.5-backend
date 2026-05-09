import { Router } from 'express';
import {
  getAllSpecialLogins,
  createSpecialLogin,
  updateSpecialLogin,
  deleteSpecialLogin,
} from '../controllers/specialLogin.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';

const router = Router();

// All routes restricted to SuperUser
router.use(verifyJWT, authorizeRoles('SuperUser'));

router.get('/', getAllSpecialLogins);
router.post('/', createSpecialLogin);
router.patch('/:id', updateSpecialLogin);
router.delete('/:id', deleteSpecialLogin);

export default router;