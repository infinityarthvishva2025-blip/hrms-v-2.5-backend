import cron from 'node-cron';
import { Employee } from '../models/Employee.model.js';
import { logger } from '../utils/logger.js';

export const initLeaveCronJobs = async () => {
  // Run immediately on startup for catch‑up
 // logger.info('⚡ Running leave accrual immediately on startup...');
  await processMonthlyLeaveAccrual();

  // Scheduled midnight on the 1st of every month
  cron.schedule('0 0 1 * *', async () => {
   // logger.info('🗓️ Running monthly leave accrual cron...');
    await processMonthlyLeaveAccrual();
  });

 // logger.info('✅ Leave cron jobs initialized');
};

export const processMonthlyLeaveAccrual = async () => {
  try {
    const now = new Date();
    const currentMonth = now.getMonth();   // 0‑based (Jan = 0)
    const currentYear = now.getFullYear();
    const isMayFirst = currentMonth === 4 && now.getDate() === 1;

  //  logger.info(`🗓️ Starting leave processing for ${now.toDateString()}...`);

    const employees = await Employee.find({ status: 'Active' });
  //  logger.info(`👥 Found ${employees.length} active employees`);

    let creditedCount = 0;
    let carryForwardCount = 0;
    let skippedProbation = 0;

    for (const emp of employees) {
      try {
        // ── 6‑MONTH PROBATION CHECK ──
        if (!emp.joiningDate) {
          skippedProbation++;
        //  logger.debug(`⏭️ Skipped ${emp._id}: no joiningDate`);
          continue;
        }

        const joiningDate = new Date(emp.joiningDate);
        const probationEnd = new Date(joiningDate);
        probationEnd.setMonth(probationEnd.getMonth() + 6);

        if (probationEnd > now) {
          skippedProbation++;
       //   logger.debug(`⏭️ Skipped ${emp._id}: probation ends ${probationEnd.toISOString()}`);
          continue;
        }

        // ── ELIGIBLE START (1st of month after probation) ──
        const eligibleStart = new Date(
          probationEnd.getFullYear(),
          probationEnd.getMonth() + 1,
          1
        );

        // Total months from eligibleStart up to current month (inclusive)
        const totalEligibleMonths =
          monthDiff(eligibleStart, new Date(currentYear, currentMonth, 1)) + 1;

        // ── COUNT REAL ACCRUALS FROM HISTORY (not lastLeaveAccrualDate) ──
        const history = emp.leaveBalanceHistory || [];
        let alreadyCredited = history
          .filter(entry => entry.type === 'Accrual' && entry.leaveType === 'Paid')
          .reduce((sum, entry) => sum + (entry.amount || 0), 0);

        const monthsToAdd = totalEligibleMonths - alreadyCredited;

        // logger.info(
        //   `👤 ${emp._id} (${emp.employeeCode}) | eligible: ${totalEligibleMonths}, already credited (from history): ${alreadyCredited}, to add: ${monthsToAdd}`
        // );

        if (monthsToAdd <= 0) {
          // logger.debug(`⏭️ ${emp._id}: already up‑to‑date`);
        } else {
          const prevBalance = emp.paidLeaveBalance || 0;
          const newBalance = prevBalance + monthsToAdd;

          emp.paidLeaveBalance = newBalance;
          emp.lastLeaveAccrualDate = now;   // update to current run date

          const historyEntry = {
            type: 'Accrual',
            leaveType: 'Paid',
            amount: monthsToAdd,
            previousBalance: prevBalance,
            newBalance,
            remarks: `Monthly accrual for ${monthsToAdd} month(s) – ${now.toLocaleString('default', { month: 'long' })} ${currentYear}`,
            timestamp: now,
          };

          emp.leaveBalanceHistory.push(historyEntry);

          logger.info(
            `✅ Credited ${monthsToAdd} leave(s) to ${emp.employeeCode}. New balance: ${newBalance}`
          );
          creditedCount += monthsToAdd;
        }

        // ── MAY 1ST CARRY‑FORWARD (history only) ──
        if (isMayFirst) {
          const carryEntry = {
            type: 'CarryOver',
            leaveType: 'Paid',
            amount: emp.paidLeaveBalance,
            previousBalance: emp.paidLeaveBalance,
            newBalance: emp.paidLeaveBalance,
            remarks: `Year‑end carry forward from FY ${currentYear - 1}-${currentYear}`,
            timestamp: now,
          };
          emp.leaveBalanceHistory.push(carryEntry);
          carryForwardCount++;
        }

        // Save if any change was made
        if (monthsToAdd > 0 || isMayFirst) {
          await emp.save();
          logger.debug(`💾 Saved ${emp._id}`);
        }
      } catch (empError) {
        logger.error(`❌ Failed to process ${emp._id}: ${empError.message}`, {
          stack: empError.stack,
        });
      }
    }

    logger.info(
      `✅ Leave cron finished. Leave months credited: ${creditedCount}, Carry‑Forward: ${carryForwardCount}, Skipped (probation): ${skippedProbation}`
    );
  } catch (error) {
    logger.error('❌ Fatal error in processMonthlyLeaveAccrual:', error);
  }
};

/**
 * Whole month difference between two dates (0‑based month values).
 */
function monthDiff(dateFrom, dateTo) {
  return (
    dateTo.getMonth() -
    dateFrom.getMonth() +
    12 * (dateTo.getFullYear() - dateFrom.getFullYear())
  );
}