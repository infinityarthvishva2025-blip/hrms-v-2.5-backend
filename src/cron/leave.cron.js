import cron from 'node-cron';
import { Employee } from '../models/Employee.model.js';
import { logger } from '../utils/logger.js';

/**
 * Initialize Leave Cron Jobs
 */
export const initLeaveCronJobs = async () => {
  // Run once on startup to catch up any missed accruals for the current month
  await processMonthlyLeaveAccrual();

  // Schedule to run at 12:00 AM on the 1st of every month
  cron.schedule('0 0 1 * *', async () => {
    logger.info('🗓️ Running scheduled monthly leave accrual...');
    await processMonthlyLeaveAccrual();
  });

  logger.info('🚀 Leave cron jobs initialized and scheduled');
};

/**
 * Process Monthly Leave Accrual and Year-End Carry Forward
 * Rules:
 * 1. Applicable from April 1, 2026.
 * 2. Employee must have completed 6 months from joining date.
 * 3. Accrual happens on the 1st of the month.
 * 4. Full carry forward happens on May 1st.
 */
export const processMonthlyLeaveAccrual = async () => {
  try {
    const now = new Date();
    const currentMonth = now.getMonth(); // 0-11
    const currentYear = now.getFullYear();
    
    // ─── SYSTEM START DATE RULE (1 April 2026) ───
    const systemStartDate = new Date(2026, 3, 1); // April 1, 2026
    if (now < systemStartDate) {
      logger.info('⏳ System start date for paid leaves (April 1, 2026) not reached yet. Skipping...');
      return;
    }

    const isMayFirst = currentMonth === 4 && now.getDate() === 1;

    logger.info(`🗓️ Processing leaves for ${now.toDateString()}...`);

    const employees = await Employee.find({ status: 'Active' });
    let creditedCount = 0;
    let carryForwardCount = 0;
    let skippedCount = 0;

    for (const emp of employees) {
      try {
        // ─── 6-MONTH RULE CHECK ───
        if (!emp.joiningDate) {
          skippedCount++;
          continue;
        }
        
        const joiningDate = new Date(emp.joiningDate);
        const eligibilityDate = new Date(joiningDate);
        eligibilityDate.setMonth(eligibilityDate.getMonth() + 6);
        
        // Final Eligibility Date is whichever is later: (Joining + 6 months) OR (April 1, 2026)
        const finalEligibilityDate = eligibilityDate > systemStartDate ? eligibilityDate : systemStartDate;

        // If today is before they become eligible, skip
        if (now < finalEligibilityDate) {
          skippedCount++;
          continue;
        }

        let updated = false;
        const historyEntries = [];

        // 1. Monthly Accrual (Check if already accrued for THIS month/year)
        const lastAccrual = emp.lastLeaveAccrualDate;
        const alreadyAccrued = lastAccrual && 
          lastAccrual.getMonth() === currentMonth && 
          lastAccrual.getFullYear() === currentYear;

        if (!alreadyAccrued) {
          const prevBalance = emp.paidLeaveBalance || 0;
          const newBalance = prevBalance + 1;
          
          emp.paidLeaveBalance = newBalance;
          emp.lastLeaveAccrualDate = now;
          
          historyEntries.push({
            type: 'Accrual',
            leaveType: 'Paid',
            amount: 1,
            previousBalance: prevBalance,
            newBalance: newBalance,
            remarks: `Monthly accrual for ${now.toLocaleString('default', { month: 'long' })} ${currentYear}`,
            timestamp: now
          });
          
          creditedCount++;
          updated = true;
        }

        // 2. May 1st Carry Forward / New Financial Year Start
        if (isMayFirst) {
          historyEntries.push({
            type: 'CarryOver',
            leaveType: 'Paid',
            amount: emp.paidLeaveBalance, 
            previousBalance: emp.paidLeaveBalance,
            newBalance: emp.paidLeaveBalance,
            remarks: `Financial Year ${currentYear-1}-${currentYear} ends. Carrying forward balance to the new year.`,
            timestamp: now
          });
          carryForwardCount++;
          updated = true;
        }

        if (updated) {
          if (historyEntries.length > 0) {
            if (!emp.leaveBalanceHistory) emp.leaveBalanceHistory = [];
            emp.leaveBalanceHistory.push(...historyEntries);
          }
          await emp.save();
        }
      } catch (empError) {
        logger.error(`❌ Error processing employee ${emp.employeeCode || emp._id}:`, empError.message);
      }
    }

    logger.info(`✅ Leave processing finished. Credited: ${creditedCount}, CarryForward: ${carryForwardCount}, Skipped: ${skippedCount}`);
  } catch (error) {
    logger.error('❌ Fatal error in processMonthlyLeaveAccrual:', error.message);
  }
};