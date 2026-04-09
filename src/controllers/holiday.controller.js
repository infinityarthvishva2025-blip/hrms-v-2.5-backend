import { Holiday } from '../models/Holiday.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getAllHolidays = asyncHandler(async (req, res) => {
  const holidays = await Holiday.find().sort({ date: 1 });
  return res.status(200).json(new ApiResponse(200, holidays, 'Holidays fetched successfully'));
});

export const createHoliday = asyncHandler(async (req, res) => {
  const { date, name, type, description } = req.body;

  if (!date || !name || !type) {
    throw new ApiError(400, 'Date, name and type are required');
  }

  const existing = await Holiday.findOne({ date });
  if (existing) {
    throw new ApiError(400, 'A holiday already exists on this date');
  }

  const holiday = await Holiday.create({
    date,
    name,
    type,
    description,
    createdBy: req.user._id,
  });

  return res.status(201).json(new ApiResponse(201, holiday, 'Holiday created successfully'));
});

export const updateHoliday = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { date, name, type, description } = req.body;

  const holiday = await Holiday.findById(id);
  if (!holiday) {
    throw new ApiError(404, 'Holiday not found');
  }

  if (date && date !== holiday.date.toISOString().split('T')[0]) {
    const existing = await Holiday.findOne({ date });
    if (existing) {
      throw new ApiError(400, 'A holiday already exists on this date');
    }
    holiday.date = date;
  }

  if (name) holiday.name = name;
  if (type) holiday.type = type;
  if (description) holiday.description = description;

  await holiday.save();

  return res.status(200).json(new ApiResponse(200, holiday, 'Holiday updated successfully'));
});

export const deleteHoliday = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const holiday = await Holiday.findByIdAndDelete(id);
  
  if (!holiday) {
    throw new ApiError(404, 'Holiday not found');
  }

  return res.status(200).json(new ApiResponse(200, null, 'Holiday deleted successfully'));
});
