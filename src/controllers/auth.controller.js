import { Employee } from '../models/Employee.model.js';

import { SpecialLogin } from '../models/specialLogin.model.js';
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

  const code = employeeCode.toUpperCase().trim();
  let user = null;
  let isSpecial = false;

  // 1️⃣ Try regular Employee
  user = await Employee.findOne({ employeeCode: code });
  if (!user) {
    // 2️⃣ Try SpecialLogin
    const special = await SpecialLogin.findOne({ specialId: code });
    if (!special) throw new ApiError(401, 'Invalid employee code or password');
    if (special.status !== 'Active') throw new ApiError(403, 'Account is deactivated. Contact admin');

    const isPwdValid = await special.comparePassword(password.trim());
    if (!isPwdValid) throw new ApiError(401, 'Invalid employee code or password');

    // Map SpecialLogin to an object compatible with token generation
    user = {
      _id: special._id,
      employeeCode: special.specialId,   // treat as employeeCode for token payload
      role: special.role,
      name: special.name || special.specialId,
      refreshToken: special.refreshToken,
      save: async function (opts) {
        special.refreshToken = this.refreshToken;
        await special.save(opts);
      },
    };
    isSpecial = true;
  } else {
    if (user.status !== 'Active') throw new ApiError(403, 'Account is deactivated. Contact HR');
    const isPwdValid = await user.comparePassword(password.trim());
    if (!isPwdValid) throw new ApiError(401, 'Invalid employee code or password');
  }

  const { accessToken, refreshToken } = await generateTokensForEmployee(user);

  // Build safe response
  const safeUser = {
    _id: user._id,
    employeeCode: user.employeeCode,
    name: user.name,
    email: user.email || '',             // SpecialLogin has no email
    role: user.role,
    department: user.department || '',
    position: user.position || '',
    profileImageUrl: user.profileImageUrl || null,
    paidLeaveBalance: user.paidLeaveBalance || 0,
    compOffBalance: user.compOffBalance || 0,
    faceDescriptor: user.faceDescriptor || [],
  };

  res
    .status(200)
    .cookie('accessToken', accessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 })
    .cookie('refreshToken', refreshToken, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 })
    .json(new ApiResponse(200, { employee: safeUser, accessToken, refreshToken }, 'Login successful'));
});

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
export const logout = asyncHandler(async (req, res) => {
  // Clear refresh token in whichever collection the user belongs to
  const userId = req.user._id;
  let updated = await Employee.findByIdAndUpdate(userId, { refreshToken: null });
  if (!updated) {
    await SpecialLogin.findByIdAndUpdate(userId, { refreshToken: null });
  }

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

  let user = await Employee.findById(decoded._id);
  if (!user) {
    user = await SpecialLogin.findById(decoded._id);
    if (!user || user.refreshToken !== token) {
      throw new ApiError(401, 'Invalid refresh token');
    }
    // Wrap for token generation
    user = {
      _id: user._id,
      employeeCode: user.specialId,
      role: user.role,
      name: user.name,
      refreshToken: user.refreshToken,
      save: async function (opts) {
        const special = await SpecialLogin.findById(this._id);
        special.refreshToken = this.refreshToken;
        await special.save(opts);
      },
    };
  } else {
    if (user.refreshToken !== token) throw new ApiError(401, 'Invalid refresh token');
  }

  const { accessToken: newAccessToken, refreshToken: newRefreshToken } =
    await generateTokensForEmployee(user);

  res
    .status(200)
    .cookie('accessToken', newAccessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 })
    .cookie('refreshToken', newRefreshToken, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 })
    .json(new ApiResponse(200, { accessToken: newAccessToken, refreshToken: newRefreshToken }, 'Token refreshed'));
});

// ─── GET ME ───────────────────────────────────────────────────────────────────
export const getMe = asyncHandler(async (req, res) => {
  let user = await Employee.findById(req.user._id).select('-password -refreshToken');
  if (!user) {
    user = await SpecialLogin.findById(req.user._id).select('-password -refreshToken');
  }
  
  if (!user) throw new ApiError(404, 'User not found');

  // Add specific mapping if needed (e.g. for frontend compatibility)
  const safeUser = user.toObject();
  if (safeUser.specialId) {
    safeUser.employeeCode = safeUser.specialId;
  }

  res.json(new ApiResponse(200, safeUser, 'Profile fetched'));
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
    paidLeaveBalance: employee.paidLeaveBalance || 0,
    compOffBalance: employee.compOffBalance || 0,
    faceDescriptor: employee.faceDescriptor || [],
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

  const userId = req.user._id;
  let user = await Employee.findById(userId);
  if (!user) {
    user = await SpecialLogin.findById(userId);
  }

  if (!user) throw new ApiError(404, 'User not found');

  const isValid = await user.comparePassword(currentPassword);
  if (!isValid) throw new ApiError(400, 'Current password is incorrect');

  user.password = newPassword;
  await user.save();

  res.json(new ApiResponse(200, null, 'Password changed successfully'));
});

// ─── FORGOT PASSWORD ──────────────────────────────────────────────────────────
export const forgotPassword = asyncHandler(async (req, res) => {
  const { employeeCode, newPassword } = req.body;

  if (!employeeCode || !newPassword) {
    throw new ApiError(400, 'Employee code and new password are required');
  }
  
  if (newPassword.length < 6) {
    throw new ApiError(400, 'New password must be at least 6 characters');
  }

  const code = employeeCode.toUpperCase().trim();
  
  // Find in both collections
  let user = await Employee.findOne({ employeeCode: code });
  let isSpecial = false;

  if (!user) {
    user = await SpecialLogin.findOne({ specialId: code });
    isSpecial = true;
  }

  if (!user) {
    throw new ApiError(404, 'Account with this employee code does not exist');
  }

  // Check if account is active before allowing reset
  if (user.status !== 'Active') {
    throw new ApiError(403, `Account is ${user.status.toLowerCase()}. Please contact HR/Admin.`);
  }

  // Update password
  user.password = newPassword;
  await user.save();

  res.status(200).json(
    new ApiResponse(200, null, 'Your password has been successfully reset. You can now sign in.')
  );
});

