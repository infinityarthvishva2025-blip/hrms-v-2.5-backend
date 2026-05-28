import { AppVersion } from '../models/AppVersion.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logger } from '../utils/logger.js';

/**
 * PUBLIC
 * POST /api/version/check
 * Body: { platform: "android", versionCode: 10 }
 * Compares the received versionCode with the latest version on the server.
 */
export const checkVersion = asyncHandler(async (req, res) => {
  const { platform, versionCode } = req.body;

  if (!platform || !versionCode) {
    throw new ApiError(400, 'platform and versionCode are required');
  }

  if (!['android', 'ios'].includes(platform.toLowerCase())) {
    throw new ApiError(400, 'platform must be "android" or "ios"');
  }

  const numericVersionCode = Number(versionCode);
  if (isNaN(numericVersionCode) || numericVersionCode < 1) {
    throw new ApiError(400, 'versionCode must be a positive number');
  }

  // Find the latest version for the given platform
  const latestVersion = await AppVersion.findOne({ platform: platform.toLowerCase() })
    .sort({ versionCode: -1 })
    .lean();

  // If no version is configured, assume no update required
  if (!latestVersion) {
    return res.status(200).json(
      new ApiResponse(200, { updateRequired: false }, 'No version configured yet')
    );
  }

  const updateRequired = numericVersionCode < latestVersion.versionCode;

  const responseData = {
    updateRequired,
    currentVersionCode: numericVersionCode,
    latestVersion: updateRequired ? latestVersion : null,
  };

  return res.status(200).json(
    new ApiResponse(200, responseData, updateRequired ? 'Update available' : 'App is up to date')
  );
});

/**
 * ADMIN – create a new app version entry
 * POST /api/version
 */
export const createAppVersion = asyncHandler(async (req, res) => {
  const { platform, versionCode, versionName, forceUpdate, updateUrl, releaseNotes } = req.body;

  if (!platform || !versionCode || !versionName || !updateUrl) {
    throw new ApiError(400, 'platform, versionCode, versionName and updateUrl are required');
  }

  const existing = await AppVersion.findOne({
    platform: platform.toLowerCase(),
    versionCode: Number(versionCode),
  });
  if (existing) {
    throw new ApiError(409, 'This version already exists for the platform');
  }

  const version = await AppVersion.create({
    platform: platform.toLowerCase(),
    versionCode: Number(versionCode),
    versionName,
    forceUpdate: !!forceUpdate,
    updateUrl,
    releaseNotes,
    createdBy: req.user._id,
  });

  logger.info(`New ${platform} version ${versionName} (code ${versionCode}) created by ${req.user._id}`);
  return res.status(201).json(
    new ApiResponse(201, version, 'App version created successfully')
  );
});

/**
 * ADMIN – update an existing version entry
 * PUT /api/version/:id
 */
export const updateAppVersion = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { versionCode, versionName, forceUpdate, updateUrl, releaseNotes } = req.body;

  const version = await AppVersion.findById(id);
  if (!version) throw new ApiError(404, 'App version not found');

  if (versionCode) version.versionCode = Number(versionCode);
  if (versionName) version.versionName = versionName;
  if (typeof forceUpdate === 'boolean') version.forceUpdate = forceUpdate;
  if (updateUrl) version.updateUrl = updateUrl;
  if (releaseNotes !== undefined) version.releaseNotes = releaseNotes;

  version.updatedBy = req.user._id;
  await version.save();

  logger.info(`App version ${id} updated by ${req.user._id}`);
  return res.status(200).json(
    new ApiResponse(200, version, 'App version updated successfully')
  );
});

/**
 * ADMIN – delete an app version entry
 * DELETE /api/version/:id
 */
export const deleteAppVersion = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const version = await AppVersion.findById(id);
  if (!version) throw new ApiError(404, 'App version not found');

  await version.deleteOne();
  logger.info(`App version ${id} deleted by ${req.user._id}`);
  return res.status(200).json(
    new ApiResponse(200, null, 'App version deleted successfully')
  );
});