import { Video } from '../models/Video.model.js';
import { Section } from '../models/Section.model.js';
import { Subsection } from '../models/Subsection.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uploadToCloudinary, deleteFromCloudinary, getPublicIdFromUrl } from '../services/cloudinary.service.js';

/**
 * Get all videos (with pagination, optional filters)
 * Access: All authenticated users
 */
export const getAllVideos = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search } = req.query;
  const filter = { isActive: true };
  if (search) {
    filter.title = { $regex: search, $options: 'i' };
  }
  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    sort: { createdAt: -1 },
    populate: { path: 'createdBy', select: 'name email' },
  };
  const result = await Video.paginate(filter, options);
  return res.status(200).json(new ApiResponse(200, result, 'Videos fetched successfully'));
});

/**
 * Get single video with its sections and subsections
 * Access: All authenticated users
 */
export const getVideoById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const video = await Video.findById(id).populate('createdBy', 'name email');
  if (!video || !video.isActive) {
    throw new ApiError(404, 'Video not found');
  }
  // Get sections with their subsections
  const sections = await Section.find({ videoId: id }).sort({ order: 1 });
  const sectionsWithSubsections = await Promise.all(
    sections.map(async (section) => {
      const subsections = await Subsection.find({ sectionId: section._id }).sort({ order: 1 });
      return { ...section.toObject(), subsections };
    })
  );
  const videoData = video.toObject();
  videoData.sections = sectionsWithSubsections;
  return res.status(200).json(new ApiResponse(200, videoData, 'Video fetched successfully'));
});

/**
 * Create a new video with file upload
 * Access: Admin only
 */
export const createVideo = asyncHandler(async (req, res) => {
  const { title, description } = req.body;
  if (!title) {
    throw new ApiError(400, 'Title is required');
  }
  if (!req.file) {
    throw new ApiError(400, 'Video file is required');
  }

  // Upload to Cloudinary
  const uploadResult = await uploadToCloudinary(req.file.buffer, {
    folder: 'gurukul/videos',
    resourceType: 'video',
  });

  const video = await Video.create({
    title,
    description,
    cloudinaryUrl: uploadResult.secure_url,
    publicId: uploadResult.public_id,
    duration: uploadResult.duration,
    thumbnail: uploadResult.thumbnail_url,
    createdBy: req.user._id,
  });

  return res.status(201).json(new ApiResponse(201, video, 'Video created successfully'));
});

/**
 * Update video metadata (and optionally replace video file)
 * Access: Admin only
 */
export const updateVideo = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, description } = req.body;

  const video = await Video.findById(id);
  if (!video || !video.isActive) {
    throw new ApiError(404, 'Video not found');
  }

  // Update metadata
  if (title) video.title = title;
  if (description) video.description = description;

  // Handle file replacement if a new video is uploaded
  if (req.file) {
    // Delete old video from Cloudinary
    if (video.publicId) {
      await deleteFromCloudinary(video.publicId);
    }
    // Upload new video
    const uploadResult = await uploadToCloudinary(req.file.buffer, {
      folder: 'gurukul/videos',
      resourceType: 'video',
    });
    video.cloudinaryUrl = uploadResult.secure_url;
    video.publicId = uploadResult.public_id;
    video.duration = uploadResult.duration;
    video.thumbnail = uploadResult.thumbnail_url;
  }

  await video.save();

  return res.status(200).json(new ApiResponse(200, video, 'Video updated successfully'));
});

/**
 * Delete video (soft delete or hard delete)
 * Access: Admin only
 */
export const deleteVideo = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const video = await Video.findById(id);
  if (!video) {
    throw new ApiError(404, 'Video not found');
  }

  // Delete from Cloudinary
  if (video.publicId) {
    await deleteFromCloudinary(video.publicId);
  }

  // Delete all associated sections and subsections
  const sections = await Section.find({ videoId: id });
  for (const section of sections) {
    await Subsection.deleteMany({ sectionId: section._id });
  }
  await Section.deleteMany({ videoId: id });

  // Hard delete video
  await Video.findByIdAndDelete(id);

  return res.status(200).json(new ApiResponse(200, null, 'Video deleted successfully'));
});