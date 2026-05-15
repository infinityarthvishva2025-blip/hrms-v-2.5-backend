import mongoose from 'mongoose';
// import { Employee } from './models/Employee.model.js'; // adjust path
// import { logger } from './utils/logger.js';
import { Employee } from '../models/Employee.model.js';
import { logger } from '../utils/logger.js';

const MONGO_URI = "mongodb+srv://infinityarthvishva2025_db_user:infinity@cluster0.uqn4y0m.mongodb.net/hrms_live_2_0";

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
            leaveType: 'Paid',
            type: { $in: ['Accrual', 'CarryOver', 'Adjustment', 'Reset'] },
          },
        },
      }
    );

    logger.info(`✅ Cleanup completed. Modified ${result.modifiedCount} employee(s).`);
    logger.info(`   - paidLeaveBalance → 0`);
    logger.info(`   - lastLeaveAccrualDate → null`);
    logger.info(`   - Removed all Paid leave history entries.`);
  } catch (error) {
    logger.error('❌ Cleanup failed:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

cleanupPaidLeaveData();