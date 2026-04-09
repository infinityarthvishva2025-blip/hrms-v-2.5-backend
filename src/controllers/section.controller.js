import { Section } from '../models/Section.model.js';
import { Video } from '../models/Video.model.js';
import { Subsection } from '../models/Subsection.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Get all sections for a video
 * Access: All authenticated users
 */
export const getSectionsByVideo = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  const video = await Video.findById(videoId);
  if (!video || !video.isActive) {
    throw new ApiError(404, 'Video not found');
  }
  const sections = await Section.find({ videoId }).sort({ order: 1 });
  return res.status(200).json(new ApiResponse(200, sections, 'Sections fetched successfully'));
});

/**
 * Create a new section under a video
 * Access: Admin only
 */
export const createSection = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  const { title, order } = req.body;

  if (!title) {
    throw new ApiError(400, 'Section title is required');
  }

  const video = await Video.findById(videoId);
  if (!video || !video.isActive) {
    throw new ApiError(404, 'Video not found');
  }

  // If order not provided, append to end
  let finalOrder = order;
  if (finalOrder === undefined) {
    const lastSection = await Section.findOne({ videoId }).sort({ order: -1 });
    finalOrder = lastSection ? lastSection.order + 1 : 0;
  }

  const section = await Section.create({
    title,
    order: finalOrder,
    videoId,
    createdBy: req.user._id,
  });

  return res.status(201).json(new ApiResponse(201, section, 'Section created successfully'));
});

/**
 * Update a section
 * Access: Admin only
 */
export const updateSection = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, order } = req.body;

  const section = await Section.findById(id);
  if (!section) {
    throw new ApiError(404, 'Section not found');
  }

  if (title) section.title = title;
  if (order !== undefined) section.order = order;

  await section.save();

  return res.status(200).json(new ApiResponse(200, section, 'Section updated successfully'));
});

/**
 * Delete a section and its subsections
 * Access: Admin only
 */
export const deleteSection = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const section = await Section.findById(id);
  if (!section) {
    throw new ApiError(404, 'Section not found');
  }

  // Delete all subsections under this section
  await Subsection.deleteMany({ sectionId: id });

  // Delete the section
  await Section.findByIdAndDelete(id);

  return res.status(200).json(new ApiResponse(200, null, 'Section deleted successfully'));
});