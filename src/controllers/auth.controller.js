import { Employee } from '../models/Employee.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../services/jwt.service.js';
import { uploadToCloudinary, getPublicIdFromUrl, deleteFromCloudinary } from '../services/cloudinary.service.js';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
};

const generateTokensForEmployee = async (employee) => {
  const payload = {
    _id: employee._id,
    employeeCode: employee.employeeCode,
    role: employee.role,
    name: employee.name,
  };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken({ _id: employee._id });

  employee.refreshToken = refreshToken;
  await employee.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────
export const login = asyncHandler(async (req, res) => {
  const { employeeCode, password } = req.body;

  if (!employeeCode || !password) {
    throw new ApiError(400, 'Employee code and password are required');
  }

  const employee = await Employee.findOne({
    employeeCode: employeeCode.toUpperCase().trim(),
  });

  if (!employee) throw new ApiError(401, 'Invalid employee code or password');
  if (employee.status !== 'Active') throw new ApiError(403, 'Account is deactivated. Contact HR');

  const isPasswordValid = await employee.comparePassword(password.trim());
  if (!isPasswordValid) {
    console.error(`Login failed for ${employeeCode}: Provided password did not match hash.`);
    throw new ApiError(401, 'Invalid employee code or password');
  }

  const { accessToken, refreshToken } = await generateTokensForEmployee(employee);

  const safeEmployee = {
    _id: employee._id,
    employeeCode: employee.employeeCode,
    name: employee.name,
    email: employee.email,
    role: employee.role,
    department: employee.department,
    position: employee.position,
    profileImageUrl: employee.profileImageUrl,
  };

  res
    .status(200)
    .cookie('accessToken', accessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 })
    .cookie('refreshToken', refreshToken, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 })
    .json(new ApiResponse(200, { employee: safeEmployee, accessToken, refreshToken }, 'Login successful'));
});

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
export const logout = asyncHandler(async (req, res) => {
  await Employee.findByIdAndUpdate(req.user._id, { refreshToken: null });

  res
    .clearCookie('accessToken', COOKIE_OPTIONS)
    .clearCookie('refreshToken', COOKIE_OPTIONS)
    .json(new ApiResponse(200, null, 'Logged out successfully'));
});

// ─── REFRESH TOKEN ────────────────────────────────────────────────────────────
export const refreshToken = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken || req.body.refreshToken;

  if (!token) throw new ApiError(401, 'Refresh token required');

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const employee = await Employee.findById(decoded._id);
  if (!employee || employee.refreshToken !== token) {
    throw new ApiError(401, 'Invalid refresh token');
  }

  const { accessToken: newAccessToken, refreshToken: newRefreshToken } =
    await generateTokensForEmployee(employee);

  res
    .status(200)
    .cookie('accessToken', newAccessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 })
    .cookie('refreshToken', newRefreshToken, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 })
    .json(new ApiResponse(200, { accessToken: newAccessToken }, 'Token refreshed'));
});

// ─── GET ME ───────────────────────────────────────────────────────────────────
export const getMe = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.user._id).select('-password -refreshToken');
  res.json(new ApiResponse(200, employee, 'Profile fetched'));
});

// ─── UPDATE PROFILE (SELF) ────────────────────────────────────────────────────
export const updateProfile = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.user._id);
  if (!employee) throw new ApiError(404, 'Employee not found');

  const { mobileNumber, currentAddress, permanentAddress, bloodGroup, emergencyContactName, emergencyContactMobile } = req.body;

  if (mobileNumber) employee.mobileNumber = mobileNumber;
  if (currentAddress) employee.currentAddress = currentAddress;
  if (permanentAddress) employee.permanentAddress = permanentAddress;
  if (bloodGroup) employee.bloodGroup = bloodGroup;
  
  if (emergencyContactName) employee.emergencyContactName = emergencyContactName;
  if (emergencyContactMobile) employee.emergencyContactMobile = emergencyContactMobile;

  // Handle Cloudinary Upload
  if (req.file) {
    // Delete old image if it exists
    if (employee.profileImageUrl) {
      const oldPublicId = getPublicIdFromUrl(employee.profileImageUrl);
      if (oldPublicId) {
        await deleteFromCloudinary(oldPublicId).catch((err) =>
          console.error('Failed to delete old profile image:', err)
        );
      }
    }
    const result = await uploadToCloudinary(req.file.buffer, { folder: 'hrms_profiles' });
    employee.profileImageUrl = result.secure_url;
  }

  await employee.save();

  const safeEmployee = {
    _id: employee._id,
    employeeCode: employee.employeeCode,
    name: employee.name,
    email: employee.email,
    role: employee.role,
    department: employee.department,
    position: employee.position,
    profileImageUrl: employee.profileImageUrl,
  };

  res.json(new ApiResponse(200, safeEmployee, 'Profile updated successfully'));
});

// ─── CHANGE PASSWORD ──────────────────────────────────────────────────────────
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new ApiError(400, 'Both current and new password are required');
  }
  if (newPassword.length < 6) {
    throw new ApiError(400, 'New password must be at least 6 characters');
  }

  const employee = await Employee.findById(req.user._id);
  const isValid = await employee.comparePassword(currentPassword);
  if (!isValid) throw new ApiError(400, 'Current password is incorrect');

  employee.password = newPassword;
  await employee.save();

  res.json(new ApiResponse(200, null, 'Password changed successfully'));
});
