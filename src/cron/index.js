import { initCronJobs as initBirthdayCron } from './birthday.cron.js';
import { initLeaveCronJobs as initLeaveCron } from './leave.cron.js';
import { logger } from '../utils/logger.js';

/**
 * Initialize all system cron jobs
 */
export const initAllCronJobs = () => {
  try {
    initBirthdayCron();
    initLeaveCron();
    logger.info('✅ All cron jobs initialized successfully');
  } catch (error) {
    logger.error('❌ Failed to initialize cron jobs:', error.message);
  }
};
