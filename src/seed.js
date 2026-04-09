import 'dotenv/config';
import mongoose from 'mongoose';
import { Employee } from './models/Employee.model.js';
import { logger } from './utils/logger.js';

const seedHR = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('Connected to MongoDB for seeding');

    // Check if user exists
    const existingUser = await Employee.findOne({ employeeCode: 'IA00091' });
    if (existingUser) {
      logger.info('User IA00091 already exists. Updating password to 123456...');
      existingUser.password = '123456';
      existingUser.role = 'HR';
      await existingUser.save();
      logger.info('User updated successfully.');
    } else {
      logger.info('Creating new HR user IA00091...');
      await Employee.create({
        employeeCode: 'IA00091',
        name: 'Super HR',
        email: 'hr@infinity.com',
        mobileNumber: '9999999999',
        password: '123456',
        role: 'HR',
        department: 'HR',
        status: 'Active',
      });
      logger.info('HR User IA00091 created successfully.');
    }

    mongoose.disconnect();
    logger.info('Database disconnected.');
    process.exit(0);
  } catch (err) {
    logger.error('Seeding failed:', err);
    process.exit(1);
  }
};

seedHR();
