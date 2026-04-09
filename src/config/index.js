import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/hrms_db',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'hrms_access_secret_2025',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'hrms_refresh_secret_2025',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  company: {
    prefix: process.env.COMPANY_PREFIX || 'IA',
  },
  office: {
    latitude: parseFloat(process.env.OFFICE_LATITUDE || '18.534202'),
    longitude: parseFloat(process.env.OFFICE_LONGITUDE || '73.839556'),
    radiusMeters: parseInt(process.env.OFFICE_RADIUS_METERS || '200'),
  },
};
