import { cloudinary } from '../config/cloudinary.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Upload a file buffer to Cloudinary
 * @param {Buffer} buffer - File buffer
 * @param {Object} options - Cloudinary upload options
 * @returns {Promise<Object>} - Cloudinary upload result
 */
export const uploadToCloudinary = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || 'hrms',
        resource_type: options.resourceType || 'auto',
        ...options,
      },
      (error, result) => {
        if (error) reject(new ApiError(500, `Cloudinary upload failed: ${error.message}`));
        else resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
};

/**
 * Delete a file from Cloudinary by public_id
 */
export const deleteFromCloudinary = async (publicId) => {
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId);
};

/**
 * Extract public_id from a Cloudinary URL
 */
export const getPublicIdFromUrl = (url) => {
  if (!url) return null;
  const parts = url.split('/');
  const fileName = parts[parts.length - 1];
  return `hrms/${fileName.split('.')[0]}`;
};
