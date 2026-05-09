import { SpecialLogin } from '../models/specialLogin.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// ─── GET ALL (SuperUser only) ────────────────────────────────────────────────
export const getAllSpecialLogins = asyncHandler(async (req, res) => {
  const logins = await SpecialLogin.find()
    .select('-password -refreshToken')
    .sort({ createdAt: -1 });
  res.json(new ApiResponse(200, logins, 'Special logins fetched'));
});

// ─── CREATE ───────────────────────────────────────────────────────────────────
export const createSpecialLogin = asyncHandler(async (req, res) => {
  const { role, password, name } = req.body;

  if (!role || !password) throw new ApiError(400, 'Role and password are required');
  if (!['HR', 'GM', 'VP', 'Director'].includes(role))
    throw new ApiError(400, 'Invalid role. Allowed: HR, GM, VP, Director');
  if (password.length < 6) throw new ApiError(400, 'Password must be at least 6 characters');

  const specialId = await SpecialLogin.generateNextId(role);

  const newLogin = await SpecialLogin.create({
    specialId,
    role,
    password,            // pre-save hook will hash
    name: name || '',
    status: 'Active',
  });

  const safe = { ...newLogin.toObject() };
  delete safe.password;
  delete safe.refreshToken;

  res.status(201).json(new ApiResponse(201, safe, `Special login ${specialId} created`));
});

// ─── UPDATE (reset password, toggle status, change name) ──────────────────────
export const updateSpecialLogin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { password, status, name } = req.body;

  const login = await SpecialLogin.findById(id);
  if (!login) throw new ApiError(404, 'Special login not found');

  if (password) {
    if (password.length < 6) throw new ApiError(400, 'Password must be at least 6 characters');
    login.password = password;
  }
  if (status && ['Active', 'Inactive'].includes(status)) {
    login.status = status;
  }
  if (name !== undefined) {
    login.name = name;
  }

  await login.save();

  const safe = { ...login.toObject() };
  delete safe.password;
  delete safe.refreshToken;

  res.json(new ApiResponse(200, safe, 'Special login updated'));
});

// ─── DELETE (hard delete – optional) ─────────────────────────────────────────
export const deleteSpecialLogin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const login = await SpecialLogin.findByIdAndDelete(id);
  if (!login) throw new ApiError(404, 'Special login not found');
  res.json(new ApiResponse(200, null, `Special login ${login.specialId} deleted`));
});