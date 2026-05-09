import { verifyAccessToken } from '../services/jwt.service.js';
import { Employee } from '../models/Employee.model.js';
import { SpecialLogin } from '../models/SpecialLogin.model.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const verifyJWT = asyncHandler(async (req, res, next) => {
  const token =
    req.cookies?.accessToken ||
    req.header('Authorization')?.replace('Bearer ', '');

  if (!token) throw new ApiError(401, 'Unauthorized: No token provided');

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    throw new ApiError(401, 'Unauthorized: Invalid or expired token');
  }

  // 1. Try regular Employee
  let user = await Employee.findById(decoded._id).select('-password -refreshToken');
  
  // 2. Try SpecialLogin if not found in Employees
  if (!user) {
    user = await SpecialLogin.findById(decoded._id).select('-password -refreshToken');
  }

  if (!user) throw new ApiError(401, 'Unauthorized: User not found');
  if (user.status !== 'Active') throw new ApiError(403, 'Account is deactivated');

  req.user = user;
  next();
});
