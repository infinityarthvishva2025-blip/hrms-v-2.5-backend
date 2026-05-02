import mongoose from 'mongoose';
// import { Employee } from './models/Employee.model.js'; // adjust path
// import { logger } from './utils/logger.js';
import { Employee } from '../models/Employee.model.js';
import { logger } from '../utils/logger.js';

const MONGO_URI = process.env.MONGO_URI || 'your_connection_string';

async function cleanupPaidLeaveData() {
  try {
    await mongoose.connect(MONGO_URI);
    logger.info('Connected to database for cleanup.');

    const result = await Employee.updateMany(
      {},
      {
        $set: {
          paidLeaveBalance: 0,
          lastLeaveAccrualDate: null,
        },
        $pull: {
          leaveBalanceHistory: {
            type: 'Accrual',
            leaveType: 'Paid',
          },
        },
      }
    );

    logger.info(`✅ Cleanup completed. Modified ${result.modifiedCount} employee(s).`);
    logger.info(`   - paidLeaveBalance → 0`);
    logger.info(`   - lastLeaveAccrualDate → null`);
    logger.info(`   - Removed all Paid 'Accrual' history entries.`);
  } catch (error) {
    logger.error('❌ Cleanup failed:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

cleanupPaidLeaveData();