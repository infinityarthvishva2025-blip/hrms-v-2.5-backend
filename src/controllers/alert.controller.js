import { Alert } from '../models/Alert.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logger } from '../utils/logger.js';

/**
 * PUBLIC
 * GET /api/alert
 * Returns whether there is an active alert (true/false) and the alert object if any.
 */
export const getActiveAlert = asyncHandler(async (req, res) => {
  const now = new Date();

  // Find the first alert that is active, started, and not yet ended (if endDate exists)
  const activeAlert = await Alert.findOne({
    active: true,
    startDate: { $lte: now },
    $or: [
      { endDate: null },
      { endDate: { $gte: now } },
    ],
  })
    .sort({ createdAt: -1 })    // newest first
    .lean();

  if (activeAlert) {
    return res.status(200).json(
      new ApiResponse(200, {
        active: true,
        alert: activeAlert,
      }, 'Active alert found')
    );
  }

  return res.status(200).json(
    new ApiResponse(200, { active: false }, 'No active alert')
  );
});

/**
 * ADMIN – create a new alert
 * POST /api/alert
 */
export const createAlert = asyncHandler(async (req, res) => {
  const { title, message, type, startDate, endDate } = req.body;

  if (!title || !message) {
    throw new ApiError(400, 'Title and message are required');
  }

  const alert = await Alert.create({
    title,
    message,
    type,
    startDate: startDate || Date.now(),
    endDate: endDate || null,
    createdBy: req.user._id,
  });

  logger.info(`Alert created by ${req.user._id} – ${title}`);
  return res.status(201).json(
    new ApiResponse(201, alert, 'Alert created successfully')
  );
});

/**
 * ADMIN – update an existing alert
 * PUT /api/alert/:id
 */
export const updateAlert = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, message, type, active, startDate, endDate } = req.body;

  const alert = await Alert.findById(id);
  if (!alert) throw new ApiError(404, 'Alert not found');

  if (title) alert.title = title;
  if (message) alert.message = message;
  if (type) alert.type = type;
  if (typeof active === 'boolean') alert.active = active;
  if (startDate !== undefined) alert.startDate = startDate;
  if (endDate !== undefined) alert.endDate = endDate;

  alert.updatedBy = req.user._id;
  await alert.save();

  logger.info(`Alert ${id} updated by ${req.user._id}`);
  return res.status(200).json(
    new ApiResponse(200, alert, 'Alert updated successfully')
  );
});

/**
 * ADMIN – delete an alert
 * DELETE /api/alert/:id
 */
export const deleteAlert = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const alert = await Alert.findById(id);
  if (!alert) throw new ApiError(404, 'Alert not found');

  await alert.deleteOne();
  logger.info(`Alert ${id} deleted by ${req.user._id}`);
  return res.status(200).json(
    new ApiResponse(200, null, 'Alert deleted successfully')
  );
});