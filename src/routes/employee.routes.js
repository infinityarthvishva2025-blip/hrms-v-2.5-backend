import { Router } from 'express';
import multer from 'multer';
import {
  getAllEmployees,
  getNextEmployeeCode,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  toggleEmployeeStatus,
  getDepartments,
  getManagementEmployees,
  updateFaceDescriptor,
  getUpcomingBirthdays,
} from '../controllers/employee.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles, CAN_CREATE_EMPLOYEE, CAN_EDIT_EMPLOYEE } from '../middleware/role.middleware.js';

const router = Router();
// Multer: memory storage (buffer → Cloudinary)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const documentFields = upload.fields([
  { name: 'profileImage', maxCount: 1 },
  { name: 'aadhaarFile', maxCount: 1 },
  { name: 'panFile', maxCount: 1 },
  { name: 'passbookFile', maxCount: 1 },
  { name: 'tenthMarksheet', maxCount: 1 },
  { name: 'twelfthMarksheet', maxCount: 1 },
  { name: 'graduationMarksheet', maxCount: 1 },
  { name: 'postGraduationMarksheet', maxCount: 1 },
  { name: 'medicalDocument', maxCount: 1 },
  { name: 'experienceCertificate', maxCount: 3 },
]);

router.use(verifyJWT);

router.get('/next-code', getNextEmployeeCode);
router.get('/departments', getDepartments);
router.get('/management', getManagementEmployees);
router.get('/', authorizeRoles(...CAN_CREATE_EMPLOYEE, 'Manager'), getAllEmployees);
router.get('/:id', getEmployeeById);
router.post('/', authorizeRoles(...CAN_CREATE_EMPLOYEE), documentFields, createEmployee);
router.put('/:id', authorizeRoles(...CAN_EDIT_EMPLOYEE), documentFields, updateEmployee);
router.put('/profile/face-descriptor', updateFaceDescriptor);
router.get('/birthdays/upcoming', getUpcomingBirthdays);
router.patch('/:id/status', authorizeRoles(...CAN_EDIT_EMPLOYEE), toggleEmployeeStatus);

export default router;
