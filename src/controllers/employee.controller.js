import { Employee } from '../models/Employee.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import { CAN_CREATE_EMPLOYEE, CAN_EDIT_EMPLOYEE } from '../middleware/role.middleware.js';

// ─── GET ALL EMPLOYEES ────────────────────────────────────────────────────────
export const getAllEmployees = asyncHandler(async (req, res) => {
  const { search, status, department, role, page = 1, limit = 50 } = req.query;
  const query = {};

  if (status) query.status = status;
  if (department) query.department = { $regex: department, $options: 'i' };
  if (role) query.role = role;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { employeeCode: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [employees, total] = await Promise.all([
    Employee.find(query)
      .select('-password -refreshToken')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Employee.countDocuments(query),
  ]);

  res.json(
    new ApiResponse(200, {
      employees,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    }, 'Employees fetched')
  );
});

// ─── GET MANAGEMENT EMPLOYEES ────────────────────────────────────────────────
export const getManagementEmployees = asyncHandler(async (req, res) => {
  const roles = ['SuperUser', 'HR', 'Manager', 'Director', 'VP', 'GM'];
  const employees = await Employee.find({ 
    role: { $in: roles },
    status: 'Active' 
  }).select('name employeeCode role');

  res.json(new ApiResponse(200, employees, 'Management employees fetched'));
});

// ─── GET NEXT EMPLOYEE CODE ───────────────────────────────────────────────────
export const getNextEmployeeCode = asyncHandler(async (req, res) => {
  const nextCode = await Employee.generateNextCode();
  res.json(new ApiResponse(200, { nextCode }, 'Next employee code generated'));
});

// ─── GET EMPLOYEE BY ID ───────────────────────────────────────────────────────
export const getEmployeeById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const employee = await Employee.findById(id).select('-password -refreshToken');
  if (!employee) throw new ApiError(404, 'Employee not found');

  // Employees/Interns can only view themselves
  if (['Employee', 'Intern'].includes(req.user.role) &&
    employee._id.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'Access denied');
  }

  res.json(new ApiResponse(200, employee, 'Employee fetched'));
});

// ─── CREATE EMPLOYEE ──────────────────────────────────────────────────────────
export const createEmployee = asyncHandler(async (req, res) => {
  // Role check
  if (!CAN_CREATE_EMPLOYEE.includes(req.user.role)) {
    throw new ApiError(403, 'Insufficient permissions to create employee');
  }

  const body = req.body;
  const files = req.files || {};

  // ── GENERATE CODE ──
  const employeeCode = await Employee.generateNextCode();

  // ── UPLOAD PROFILE IMAGE ──
  let profileImageUrl;
  if (files.profileImage?.[0]) {
    const result = await uploadToCloudinary(files.profileImage[0].buffer, {
      folder: `hrms/employees/${employeeCode}`,
      public_id: 'profile',
    });
    profileImageUrl = result.secure_url;
  }

  // ── UPLOAD OTHER DOCS ──
  const docUploads = {};
  const docFields = ['aadhaarFile', 'panFile', 'passbookFile', 'tenthMarksheet',
    'twelfthMarksheet', 'graduationMarksheet', 'postGraduationMarksheet',
    'medicalDocument', 'experienceCertificate'];

  for (const field of docFields) {
    if (files[field]?.[0]) {
      const result = await uploadToCloudinary(files[field][0].buffer, {
        folder: `hrms/employees/${employeeCode}/docs`,
        public_id: field,
      });
      docUploads[`${field}Url`] = result.secure_url;
    }
  }

  // ── CHECK UNIQUE ──
  const [existingEmail, existingMobile] = await Promise.all([
    Employee.findOne({ email: body.email }),
    Employee.findOne({ mobileNumber: body.mobileNumber }),
  ]);
  if (existingEmail) throw new ApiError(409, 'Email already exists');
  if (existingMobile) throw new ApiError(409, 'Mobile number already exists');

  const employee = await Employee.create({
    employeeCode,
    name: body.name,
    email: body.email,
    password: body.password || '123456',  // default password
    mobileNumber: body.mobileNumber,
    alternateMobileNumber: body.alternateMobileNumber,
    gender: body.gender,
    dateOfBirth: body.dateOfBirth,
    maritalStatus: body.maritalStatus,
    fatherName: body.fatherName,
    motherName: body.motherName,
    currentAddress: body.currentAddress,
    permanentAddress: body.permanentAddress,
    district: body.district,
    state: body.state,
    pincode: body.pincode,
    joiningDate: body.joiningDate,
    department: body.department,
    position: body.position,
    role: body.role || 'Employee',
    salary: body.salary,
    reportingManager: body.reportingManager,
    experienceType: body.experienceType,
    totalExperienceYears: body.totalExperienceYears,
    lastCompanyName: body.lastCompanyName,
    hscPercent: body.hscPercent,
    graduationCourse: body.graduationCourse,
    graduationPercent: body.graduationPercent,
    postGraduationCourse: body.postGraduationCourse,
    postGraduationPercent: body.postGraduationPercent,
    aadhaarNumber: body.aadhaarNumber,
    panNumber: body.panNumber,
    accountHolderName: body.accountHolderName,
    bankName: body.bankName,
    accountNumber: body.accountNumber,
    ifsc: body.ifsc,
    branch: body.branch,
    emergencyContactName: body.emergencyContactName,
    emergencyContactRelationship: body.emergencyContactRelationship,
    emergencyContactMobile: body.emergencyContactMobile,
    emergencyContactAddress: body.emergencyContactAddress,
    hasDisease: body.hasDisease || 'No',
    diseaseName: body.diseaseName,
    profileImageUrl,
    ...docUploads,
    status: 'Active',
  });

  res.status(201).json(
    new ApiResponse(201, employee.toSafeObject(), 'Employee created successfully')
  );
});

// ─── UPDATE EMPLOYEE ──────────────────────────────────────────────────────────
export const updateEmployee = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const files = req.files || {};

  const employee = await Employee.findById(id);
  if (!employee) throw new ApiError(404, 'Employee not found');

  // Role check  
  if (!CAN_EDIT_EMPLOYEE.includes(req.user.role)) {
    throw new ApiError(403, 'Insufficient permissions to edit employee');
  }

  // ── UPDATE PROFILE IMAGE ──
  if (files.profileImage?.[0]) {
    const result = await uploadToCloudinary(files.profileImage[0].buffer, {
      folder: `hrms/employees/${employee.employeeCode}`,
      public_id: 'profile',
    });
    employee.profileImageUrl = result.secure_url;
  }

  // ── UPDATE OTHER DOCS ──
  const docFields = ['aadhaarFile', 'panFile', 'passbookFile', 'tenthMarksheet',
    'twelfthMarksheet', 'graduationMarksheet', 'postGraduationMarksheet',
    'medicalDocument', 'experienceCertificate'];

  for (const field of docFields) {
    if (files[field]?.[0]) {
      const result = await uploadToCloudinary(files[field][0].buffer, {
        folder: `hrms/employees/${employee.employeeCode}/docs`,
        public_id: field,
      });
      employee[`${field}Url`] = result.secure_url;
    }
  }

  // ── APPLY UPDATES ──
  const fields = ['name', 'email', 'mobileNumber', 'alternateMobileNumber',
    'gender', 'dateOfBirth', 'maritalStatus', 'fatherName', 'motherName',
    'currentAddress', 'permanentAddress', 'district', 'state', 'pincode',
    'joiningDate', 'department', 'position', 'role', 'salary', 'reportingManager',
    'experienceType', 'totalExperienceYears', 'lastCompanyName',
    'hscPercent', 'graduationCourse', 'graduationPercent',
    'postGraduationCourse', 'postGraduationPercent',
    'aadhaarNumber', 'panNumber', 'accountHolderName', 'bankName',
    'accountNumber', 'ifsc', 'branch',
    'emergencyContactName', 'emergencyContactRelationship',
    'emergencyContactMobile', 'emergencyContactAddress',
    'hasDisease', 'diseaseName', 'diseaseType', 'diseaseSince',
    'medicinesRequired', 'doctorName', 'doctorContact'];

  for (const field of fields) {
    if (body[field] !== undefined) employee[field] = body[field];
  }

  // ── PASSWORD UPDATE ──
  if (body.password) {
    if (body.password !== body.confirmPassword) {
      throw new ApiError(400, 'Passwords do not match');
    }
    employee.password = body.password;
  }

  await employee.save();

  res.json(new ApiResponse(200, employee.toSafeObject(), 'Employee updated successfully'));
});

// ─── TOGGLE EMPLOYEE STATUS ───────────────────────────────────────────────────
export const toggleEmployeeStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, reason } = req.body;

  if (!CAN_EDIT_EMPLOYEE.includes(req.user.role)) {
    throw new ApiError(403, 'Insufficient permissions to change employee status');
  }

  const employee = await Employee.findById(id);
  if (!employee) throw new ApiError(404, 'Employee not found');

  employee.status = status;
  if (status === 'Inactive') {
    employee.deactivateReason = reason || 'No reason provided';
  } else {
    employee.deactivateReason = null;
  }
  await employee.save({ validateBeforeSave: false });

  res.json(new ApiResponse(200, employee.toSafeObject(), `Employee status changed to ${status}`));
});

// ─── UPDATE FACE DESCRIPTOR ──────────────────────────────────────────────────
export const updateFaceDescriptor = asyncHandler(async (req, res) => {
  const { faceDescriptor } = req.body;
  
  if (!faceDescriptor || !Array.isArray(faceDescriptor)) {
    throw new ApiError(400, 'Invalid face descriptor. Must be an array of numbers.');
  }

  const employee = await Employee.findById(req.user._id);
  if (!employee) throw new ApiError(404, 'Employee not found');

  employee.faceDescriptor = faceDescriptor;
  await employee.save({ validateBeforeSave: false });

  res.json(new ApiResponse(200, { faceDescriptor: employee.faceDescriptor }, 'Face ID registered successfully'));
});

// ─── GET DEPARTMENTS ──────────────────────────────────────────────────────────
export const getDepartments = asyncHandler(async (req, res) => {
  const departments = await Employee.distinct('department', {
    department: { $ne: null, $ne: '' },
  });
  res.json(new ApiResponse(200, departments.sort(), 'Departments fetched'));
});

// ─── GET UPCOMING BIRTHDAYS (Today & Tomorrow) ───────────────────────────────
export const getUpcomingBirthdays = asyncHandler(async (req, res) => {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  const tMonth = today.getMonth() + 1;
  const tDay = today.getDate();

  const tmMonth = tomorrow.getMonth() + 1;
  const tmDay = tomorrow.getDate();

  const [todayBirthdays, tomorrowBirthdays] = await Promise.all([
    Employee.find({
      status: 'Active',
      $expr: {
        $and: [
          { $eq: [{ $month: '$dateOfBirth' }, tMonth] },
          { $eq: [{ $dayOfMonth: '$dateOfBirth' }, tDay] }
        ]
      }
    }).select('name employeeCode profileImageUrl department dateOfBirth'),
    Employee.find({
      status: 'Active',
      $expr: {
        $and: [
          { $eq: [{ $month: '$dateOfBirth' }, tmMonth] },
          { $eq: [{ $dayOfMonth: '$dateOfBirth' }, tmDay] }
        ]
      }
    }).select('name employeeCode profileImageUrl department dateOfBirth')
  ]);

  res.json(
    new ApiResponse(200, {
      today: todayBirthdays,
      tomorrow: tomorrowBirthdays
    }, 'Upcoming birthdays fetched')
  );
});
 

// ─── UPDATE FCM TOKEN ─────────────────────────────────────────────────────────
export const updateFcmToken = asyncHandler(async (req, res) => {
  const { fcmToken } = req.body;

  if (!fcmToken) {
    throw new ApiError(400, 'FCM token is required');
  }

  const employee = await Employee.findById(req.user._id);
  if (!employee) throw new ApiError(404, 'Employee not found');

  employee.fcmToken = fcmToken;
  await employee.save({ validateBeforeSave: false });

  res.json(new ApiResponse(200, null, 'FCM token updated successfully'));
});
