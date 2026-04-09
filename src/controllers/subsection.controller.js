import { Subsection } from '../models/Subsection.model.js';
import { Section } from '../models/Section.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Get all subsections for a section
 * Access: All authenticated users
 */
export const getSubsectionsBySection = asyncHandler(async (req, res) => {
  const { sectionId } = req.params;
  const section = await Section.findById(sectionId);
  if (!section) {
    throw new ApiError(404, 'Section not found');
  }
  const subsections = await Subsection.find({ sectionId }).sort({ order: 1 });
  return res.status(200).json(new ApiResponse(200, subsections, 'Subsections fetched successfully'));
});

/**
 * Create a new subsection under a section
 * Access: Admin only
 */
export const createSubsection = asyncHandler(async (req, res) => {
  const { sectionId } = req.params;
  const { title, order, content } = req.body;

  if (!title) {
    throw new ApiError(400, 'Subsection title is required');
  }

  const section = await Section.findById(sectionId);
  if (!section) {
    throw new ApiError(404, 'Section not found');
  }

  // If order not provided, append to end
  let finalOrder = order;
  if (finalOrder === undefined) {
    const lastSubsection = await Subsection.findOne({ sectionId }).sort({ order: -1 });
    finalOrder = lastSubsection ? lastSubsection.order + 1 : 0;
  }

  const subsection = await Subsection.create({
    title,
    order: finalOrder,
    sectionId,
    content,
    createdBy: req.user._id,
  });

  return res.status(201).json(new ApiResponse(201, subsection, 'Subsection created successfully'));
});

/**
 * Update a subsection
 * Access: Admin only
 */
export const updateSubsection = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, order, content } = req.body;

  const subsection = await Subsection.findById(id);
  if (!subsection) {
    throw new ApiError(404, 'Subsection not found');
  }

  if (title) subsection.title = title;
  if (order !== undefined) subsection.order = order;
  if (content !== undefined) subsection.content = content;

  await subsection.save();

  return res.status(200).json(new ApiResponse(200, subsection, 'Subsection updated successfully'));
});

/**
 * Delete a subsection
 * Access: Admin only
 */
export const deleteSubsection = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const subsection = await Subsection.findByIdAndDelete(id);
  if (!subsection) {
    throw new ApiError(404, 'Subsection not found');
  }
  return res.status(200).json(new ApiResponse(200, null, 'Subsection deleted successfully'));
});