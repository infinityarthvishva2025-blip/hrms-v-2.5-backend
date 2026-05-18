/**
 * Seed Comp Off Balance – Employee IA00104
 * Idempotent script to add one Comp Off earned on 26 April 2026.
 * Stores all required fields in leaveBalanceHistory.
 *
 * Usage: node seeds/compOffSeed.js
 */

import mongoose from 'mongoose';
import { Employee } from '../models/Employee.model.js';
import { connectDB } from '../config/db.js';
import { logger } from '../utils/logger.js';

// ──────────────────────────── CONFIG ────────────────────────────
const TARGET_EMPLOYEE_CODE = 'IA00005';
const COMP_OFF_DATE_STRING = '2026-04-12';   // YYYY-MM-DD
const COMP_OFF_AMOUNT = 1;                   // one day
const EXPIRY_DAYS = 90;                      // expires after 90 days

// ──────────────────────────── HELPERS ────────────────────────────
/**
 * Returns a Date object representing midnight UTC of the given YYYY-MM-DD string.
 */
function toUTCMidnight(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)); // months are 0-indexed
}

// ──────────────────────────── MAIN ────────────────────────────
const seedCompOff = async () => {
  try {
    await connectDB();
    logger.info('Connected to DB. Seeding Comp Off...');

    // Build fixed dates
    const earnedDate = toUTCMidnight(COMP_OFF_DATE_STRING);
    const expiryDate = new Date(earnedDate.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    // ── Idempotency check: look for an existing history entry ──
    const existing = await Employee.findOne({
      employeeCode: TARGET_EMPLOYEE_CODE,
      leaveBalanceHistory: {
        $elemMatch: {
          leaveType: 'CompOff',
          type: 'Accrual',
          earnedDate: earnedDate, // exact match on UTC midnight
        },
      },
    });

    if (existing) {
      logger.info(
        `Comp Off for ${TARGET_EMPLOYEE_CODE} on ${COMP_OFF_DATE_STRING} already exists. Skipping.`
      );
      process.exit(0);
    }

    // ── Find the target employee ──
    const employee = await Employee.findOne({ employeeCode: TARGET_EMPLOYEE_CODE });
    if (!employee) {
      logger.error(`Employee ${TARGET_EMPLOYEE_CODE} not found. Aborting.`);
      process.exit(1);
    }

    // Current balance (default to 0 if undefined / null)
    const previousBalance = employee.compOffBalance ?? 0;
    const newBalance = previousBalance + COMP_OFF_AMOUNT;

    // ── Build the history entry ──
    const historyEntry = {
      type: 'Accrual',
      leaveType: 'CompOff',
      amount: COMP_OFF_AMOUNT,
      previousBalance,
      newBalance,
      remarks: `Comp Off earned on ${COMP_OFF_DATE_STRING}`,
      timestamp: new Date(),
      earnedDate,
      expiryDate,
      isUsed: false,
      usedDate: null,    // not used yet
    };

    // ── Atomically update balance and push history ──
    const updatedEmployee = await Employee.findOneAndUpdate(
      { employeeCode: TARGET_EMPLOYEE_CODE },
      {
        $inc: { compOffBalance: COMP_OFF_AMOUNT },
        $push: { leaveBalanceHistory: historyEntry },
      },
      { new: true, runValidators: true }
    );

    if (!updatedEmployee) {
      logger.error('Update failed unexpectedly.');
      process.exit(1);
    }

    logger.info(
      `Comp Off added for ${TARGET_EMPLOYEE_CODE}. Balance: ${updatedEmployee.compOffBalance}, History ID: ${updatedEmployee.leaveBalanceHistory[updatedEmployee.leaveBalanceHistory.length - 1]._id}`
    );

    process.exit(0);
  } catch (error) {
    logger.error(`Seeding failed: ${error.message}`);
    process.exit(1);
  }
};

// ──────────────────────────── EXECUTE ────────────────────────────
seedCompOff();