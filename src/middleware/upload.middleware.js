import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

// Configure multer for memory storage
const storage = multer.memoryStorage();

// File filter: accept only video files
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, 'Only video files are allowed'), false);
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
});