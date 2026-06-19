import cron from 'node-cron';
import { Employee } from '../models/Employee.model.js';
import { logger } from '../utils/logger.js';

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
// The first month paid leave accrual is active (April 2026 → month index 3)
const SYSTEM_START_YEAR  = 2026;
const SYSTEM_START_MONTH = 3; // 0-indexed: April = 3

/**
 * Initialize Leave Cron Jobs.
 * - Runs a catch-up pass immediately on startup so missed months are credited.
 * - Schedules a recurring job on the 1st of every month at midnight.
 */


export const initLeaveCronJobs = async () => {
  logger.info('🚀 Initializing leave cron jobs...');

  // Immediate catch-up run on server start
  // await processMonthlyLeaveAccrual({ triggeredBy: 'startup' });

  // Scheduled: 00:00 on the 1st of every month
  cron.schedule('0 0 1 * *', async () => {
    logger.info('🗓️ Running scheduled monthly leave accrual (1st of month)...');
    await processMonthlyLeaveAccrual();
  });
 // processMonthlyLeaveAccrual();

  logger.info('✅ Leave cron jobs initialized and scheduled (runs on 1st of each month at 00:00)');
};





/**
 * Build a canonical string key for a month — used for idempotent dedup.
 * @param {number} year  Full year (e.g. 2026)
 * @param {number} month 0-indexed month (0 = Jan … 11 = Dec)
 * @returns {string} e.g. "2026-04"
 */
const monthKey = (year, month) =>
  `${year}-${String(month + 1).padStart(2, '0')}`;

/**
 * Return human-readable month name for remarks.
 * @param {number} month 0-indexed
 */
const monthName = (month) =>
  new Date(2000, month, 1).toLocaleString('default', { month: 'long' });

/**
 * Get the Set of month keys already credited, derived from leaveBalanceHistory.
 * This is the secondary dedup guard — immune to lastLeaveAccrualDate corruption.
 * @param {Array} history  emp.leaveBalanceHistory
 * @returns {Set<string>}
 */
const getCreditedMonthKeys = (history = []) => {
  const keys = new Set();
  for (const entry of history) {
    if (entry.type === 'Accrual' && entry.leaveType === 'Paid' && entry.accrualMonthKey) {
      keys.add(entry.accrualMonthKey);
    }
  }
  return keys;
};

/**
 * Core accrual processor.
 *
 * Strategy:
 * 1. Build the list of months that SHOULD have been credited, starting from
 *    the employee's eligibility month (max of: DOJ+6 months, April 2026)
 *    up to and including the CURRENT month.
 * 2. For each such month, check if it was already credited (idempotent).
 * 3. Credit any missing months in sequence, updating balance step-by-step.
 *
 * This makes the function fully idempotent — safe to rerun on server restart,
 * missed cron, or manual trigger.
 *
 * @param {{ triggeredBy?: string }} [options]
 */
export const processMonthlyLeaveAccrual = async ({ triggeredBy = 'manual' } = {}) => {
  const runId = Date.now(); // unique ID per run for log tracing
  logger.info(`[LeaveAccrual#${runId}] ▶ Starting — triggered by: ${triggeredBy}`);

  try {
    const now = new Date();
    const todayYear  = now.getFullYear();
    const todayMonth = now.getMonth(); // 0-indexed

    // Guard: do nothing before the system start date
    if (
      todayYear < SYSTEM_START_YEAR ||
      (todayYear === SYSTEM_START_YEAR && todayMonth < SYSTEM_START_MONTH)
    ) {
      logger.info(`[LeaveAccrual#${runId}] ⏳ System start (April 2026) not yet reached. Skipping.`);
      return;
    }

    const employees = await Employee.find({ status: 'Active' }).select(
      'employeeCode joiningDate paidLeaveBalance lastLeaveAccrualDate leaveBalanceHistory'
    );

    logger.info(`[LeaveAccrual#${runId}] 👥 Found ${employees.length} active employee(s).`);

    let totalCredited      = 0;
    let totalSkipped       = 0;
    let totalAlreadyDone   = 0;
    let totalErrors        = 0;

    for (const emp of employees) {
      try {
        // ── 1. Validate joining date ─────────────────────────────────────────
        if (!emp.joiningDate) {
          logger.warn(`[LeaveAccrual#${runId}] ⚠️  ${emp.employeeCode}: No joining date — skipped.`);
          totalSkipped++;
          continue;
        }

        const doj = new Date(emp.joiningDate);

        // ── 2. Compute eligibility start month ───────────────────────────────
        // DOJ + 6 months, then take the later of that vs. system start (April 2026)
        const eligDate = new Date(doj);
        eligDate.setMonth(eligDate.getMonth() + 6);

        let eligYear  = eligDate.getFullYear();
        let eligMonth = eligDate.getMonth(); // 0-indexed

        // Clamp to system start
        if (
          eligYear < SYSTEM_START_YEAR ||
          (eligYear === SYSTEM_START_YEAR && eligMonth < SYSTEM_START_MONTH)
        ) {
          eligYear  = SYSTEM_START_YEAR;
          eligMonth = SYSTEM_START_MONTH;
        }

        // If eligibility is still in the future, skip
        if (
          eligYear > todayYear ||
          (eligYear === todayYear && eligMonth > todayMonth)
        ) {
          logger.info(
            `[LeaveAccrual#${runId}] ⏭  ${emp.employeeCode}: ` +
            `Not yet eligible until ${monthKey(eligYear, eligMonth)}. Skipped.`
          );
          totalSkipped++;
          continue;
        }

        // ── 3. Build list of months to credit ────────────────────────────────
        // All months from eligibility month up to (and including) the current month.
        const monthsToProcess = [];
        let mYear  = eligYear;
        let mMonth = eligMonth;
        while (
          mYear < todayYear ||
          (mYear === todayYear && mMonth <= todayMonth)
        ) {
          monthsToProcess.push({ year: mYear, month: mMonth });
          mMonth++;
          if (mMonth > 11) { mMonth = 0; mYear++; }
        }
        
        // ── 4. Determine already-credited months (idempotent guard) ───────────
        const creditedKeys = getCreditedMonthKeys(emp.leaveBalanceHistory);

        // Secondary guard: also trust lastLeaveAccrualDate if history keys are absent
        // (handles employees created before accrualMonthKey was introduced)
        if (emp.lastLeaveAccrualDate) {
          const lad = new Date(emp.lastLeaveAccrualDate);
          const ladKey = monthKey(lad.getFullYear(), lad.getMonth());
          // If this key is not in history yet, add it to the already-credited set
          if (!creditedKeys.has(ladKey)) {
            creditedKeys.add(ladKey);
          }
        }

        // ── 5. Credit missing months ─────────────────────────────────────────
        let empBalance       = emp.paidLeaveBalance || 0;
        let empUpdated       = false;
        const newHistEntries = [];

        for (const { year, month } of monthsToProcess) {
          const key = monthKey(year, month);

          if (creditedKeys.has(key)) {
            // Already credited
            continue;
          }

          // Credit 1 paid leave for this month
          const prevBalance = empBalance;
          empBalance += 1;

          newHistEntries.push({
            type:            'Accrual',
            leaveType:       'Paid',
            amount:          1,
            previousBalance: prevBalance,
            newBalance:      empBalance,
            accrualMonthKey: key, 
            remarks:         `Monthly paid leave accrual for ${monthName(month)} ${year}`,
            timestamp:       now,
          });

          creditedKeys.add(key); 
          empUpdated = true;
          totalCredited++;

          logger.info(`[LeaveAccrual#${runId}] ✅ ${emp.employeeCode}: Credited 1 PL for ${key}.`);
        }

        // ── 6. Idempotent Carry-Forward (Financial Year End: April 1st) ──────
        // Strategy: For every year AFTER system start up to current year,
        // if we have passed April 1st of that year, ensure a CarryOver entry exists.
        for (let y = SYSTEM_START_YEAR + 1; y <= todayYear; y++) {
          const carryFwdDate = new Date(Date.UTC(y, 3, 1)); // April 1st UTC
          if (now >= carryFwdDate) {
            const carryFwdKey = `carryover-${y}`;
            const alreadyDone = (emp.leaveBalanceHistory || []).some(
              (h) => h.type === 'CarryOver' && h.accrualMonthKey === carryFwdKey
            );

            if (!alreadyDone) {
              newHistEntries.push({
                type:            'CarryOver',
                leaveType:       'Paid',
                amount:          empBalance,
                previousBalance: empBalance,
                newBalance:      empBalance,
                accrualMonthKey: carryFwdKey,
                remarks:         `FY ${y - 1}-${y} end carry-forward. Balance: ${empBalance}`,
                timestamp:       now,
              });
              empUpdated = true;
              logger.info(`[LeaveAccrual#${runId}] 📦 ${emp.employeeCode}: Catch-up CarryOver for FY ${y-1}-${y}`);
            }
          }
        }

        // ── 7. Persist changes ───────────────────────────────────────────────
        if (empUpdated) {
          emp.paidLeaveBalance   = empBalance;
          emp.lastLeaveAccrualDate = now;

          if (!emp.leaveBalanceHistory) emp.leaveBalanceHistory = [];
          emp.leaveBalanceHistory.push(...newHistEntries);

          await emp.save();
          logger.info(
            `[LeaveAccrual#${runId}] 💾 ${emp.employeeCode}: Saved. Final PL balance: ${empBalance}`
          );
        } else {
          logger.info(
            `[LeaveAccrual#${runId}] ➖ ${emp.employeeCode}: Nothing new to credit.`
          );
        }
      } catch (empError) {
        totalErrors++;
        logger.error(
          `[LeaveAccrual#${runId}] ❌ Error processing ${emp.employeeCode || emp._id}: ${empError.message}`,
          empError
        );
      }
    }

    logger.info(
      `[LeaveAccrual#${runId}] ✅ Done. ` +
      `Credited: ${totalCredited} | Already done: ${totalAlreadyDone} | ` +
      `Skipped: ${totalSkipped} | Errors: ${totalErrors}`
    );
  } catch (error) {
    logger.error(`[LeaveAccrual#${runId}] ❌ Fatal error: ${error.message}`, error);
  }
};