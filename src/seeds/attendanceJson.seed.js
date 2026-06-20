/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PRODUCTION-GRADE ATTENDANCE SEED & IMPORT SYSTEM (JSON-DRIVEN)
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 * DESCRIPTION:
 * This script seeds/imports structured JSON-defined attendance records directly 
 * into the MongoDB database. It performs strict validation, handles different
 * attendance statuses (P, A, WO, L, Coff, AUTO, H, Half), enforces UTC midnight 
 * date normalization, prevents duplicates using bulk upsert operations, and 
 * triggers automated payroll updates to maintain complete cross-module integrity.
 *
 * EXECUTION GUIDE:
 * 1. Configure backend environment variables (.env).
 * 2. Run from root directory:
 *    node backend/src/seeds/attendanceJson.seed.js
 * 
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Attendance } from '../models/Attendance.model.js';
import { Employee } from '../models/Employee.model.js';
import { Payroll } from '../models/Payroll.model.js';
import { connectDB } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { processSingleEmployeePayroll } from '../controllers/payroll.controller.js';

// Resolve directory paths for logging/context
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURABLE STRUCTURED ATTENDANCE DATA JSON
// Easily add, modify, or update records below.
// ─────────────────────────────────────────────────────────────────────────────
const ATTENDANCE_JSON_DATA = [
  {
    employeeCode: "IA00092",
    date: "2026-06-08",
    status: "P",
    inTime: "09:49:00", // On time (Shift starts at 09:30)
    outTime: "18:21:00",
    workMode: "Office",
    todayWork: "",
    pendingWork: "NA",
    issuesFaced: "None"
  },
  //  {
  //   employeeCode: "IA00029",
  //   date: "2026-06-17",
  //   status: "P",
  //   inTime: "09:49:00", // On time (Shift starts at 09:30)
  //   outTime: "18:21:00",
  //   workMode: "Office",
  //   todayWork: "",
  //   pendingWork: "NA",
  //   issuesFaced: "None"
  // },
  //   {
  //   employeeCode: "IA00029",
  //   date: "2026-06-18",
  //   status: "P",
  //   inTime: "09:49:00", // On time (Shift starts at 09:30)
  //   outTime: "18:21:00",
  //   workMode: "Office",
  //   todayWork: "",
  //   pendingWork: "NA",
  //   issuesFaced: "None"
  // },
  //     {
  //   employeeCode: "IA00117",
  //   date: "2026-05-09",
  //   status: "P",
  //   inTime: "09:49:00", // On time (Shift starts at 09:30)
  //   outTime: "18:21:00",
  //   workMode: "Office",
  //   todayWork: "",
  //   pendingWork: "NA",
  //   issuesFaced: "None"
  // },
  //       {
  //   employeeCode: "IA00117",
  //   date: "2026-04-10",
  //   status: "P",
  //   inTime: "09:49:00", // On time (Shift starts at 09:30)
  //   outTime: "18:21:00",
  //   workMode: "Office",
  //   todayWork: "",
  //   pendingWork: "NA",
  //   issuesFaced: "None"
  // }
  // ,
  //     {
  //   employeeCode: "IA00117",
  //   date: "2026-05-11",
  //   status: "P",
  //   inTime: "09:49:00", // On time (Shift starts at 09:30)
  //   outTime: "18:21:00",
  //   workMode: "Office",
  //   todayWork: "",
  //   pendingWork: "NA",
  //   issuesFaced: "None"
  // },
  //     {
  //   employeeCode: "IA00117",
  //   date: "2026-05-13",
  //   status: "P",
  //   inTime: "09:49:00", // On time (Shift starts at 09:30)
  //   outTime: "18:21:00",
  //   workMode: "Office",
  //   todayWork: "",
  //   pendingWork: "NA",
  //   issuesFaced: "None"
  // },

  //       {
  //   employeeCode: "IA00117",
  //   date: "2026-05-14",
  //   status: "P",
  //   inTime: "09:49:00", // On time (Shift starts at 09:30)
  //   outTime: "18:21:00",
  //   workMode: "Office",
  //   todayWork: "",
  //   pendingWork: "NA",
  //   issuesFaced: "None"
  // },
  //         {
  //   employeeCode: "IA00117",
  //   date: "2026-05-19",
  //   status: "P",
  //   inTime: "09:49:00", // On time (Shift starts at 09:30)
  //   outTime: "18:21:00",
  //   workMode: "Office",
  //   todayWork: "",
  //   pendingWork: "NA",
  //   issuesFaced: "None"
  // }






  // {
  //   employeeCode: "IA00117",
  //   date: "2026-04-21",
  //   status: "P",
  //   inTime: "09:45:00", // Late (Shift starts at 09:30)
  //   outTime: "18:15:00",
  //   workMode: "Office",
  //   todayWork: "Designed scroll-linked interactive header with opacity animations.",
  //   pendingWork: "Integrate premium color palettes onto mobile dashboard views.",
  //   issuesFaced: "None"
  // },
  // {
  //   employeeCode: "IA00092",
  //   date: "2026-04-21",
  //   status: "Half", // Half Day
  //   inTime: "09:20:00",
  //   outTime: "13:50:00",
  //   workMode: "Office",
  //   todayWork: "Conducted review of backend payroll calculation routines.",
  //   pendingWork: "Implement automated Professional Tax deductions logic.",
  //   issuesFaced: "Left early due to dental checkup."
  // },
  //   {
  //   employeeCode: "IA00092",
  //   date: "2026-04-22",
  //   status: "Half", // Half Day
  //   inTime: "09:20:00",
  //   outTime: "13:50:00",
  //   workMode: "Office",
  //   todayWork: "Conducted review of backend payroll calculation routines.",
  //   pendingWork: "Implement automated Professional Tax deductions logic.",
  //   issuesFaced: "Left early due to dental checkup."
  // },
  //   {
  //   employeeCode: "IA00092",
  //   date: "2026-04-24",
  //   status: "Half", // Half Day
  //   inTime: "09:20:00",
  //   outTime: "13:50:00",
  //   workMode: "Office",
  //   todayWork: "Conducted review of backend payroll calculation routines.",
  //   pendingWork: "Implement automated Professional Tax deductions logic.",
  //   issuesFaced: "Left early due to dental checkup."
  // },
  //   {
  //   employeeCode: "IA00092",
  //   date: "2026-04-25",
  //   status: "Half", // Half Day
  //   inTime: "09:20:00",
  //   outTime: "13:50:00",
  //   workMode: "Office",
  //   todayWork: "Conducted review of backend payroll calculation routines.",
  //   pendingWork: "Implement automated Professional Tax deductions logic.",
  //   issuesFaced: "Left early due to dental checkup."
  // },
  //   {
  //   employeeCode: "IA00092",
  //   date: "2026-04-27",
  //   status: "Half", // Half Day
  //   inTime: "09:20:00",
  //   outTime: "13:50:00",
  //   workMode: "Office",
  //   todayWork: "Conducted review of backend payroll calculation routines.",
  //   pendingWork: "Implement automated Professional Tax deductions logic.",
  //   issuesFaced: "Left early due to dental checkup."
  // },
  //   {
  //   employeeCode: "IA00092",
  //   date: "2026-04-28",
  //   status: "Half", // Half Day
  //   inTime: "09:20:00",
  //   outTime: "13:50:00",
  //   workMode: "Office",
  //   todayWork: "Conducted review of backend payroll calculation routines.",
  //   pendingWork: "Implement automated Professional Tax deductions logic.",
  //   issuesFaced: "Left early due to dental checkup."
  // },
  //   {
  //   employeeCode: "IA00092",
  //   date: "2026-04-29",
  //   status: "Half", // Half Day
  //   inTime: "09:20:00",
  //   outTime: "13:50:00",
  //   workMode: "Office",
  //   todayWork: "Conducted review of backend payroll calculation routines.",
  //   pendingWork: "Implement automated Professional Tax deductions logic.",
  //   issuesFaced: "Left early due to dental checkup."
  // },
  //   {
  //   employeeCode: "IA00092",
  //   date: "2026-04-30",
  //   status: "Half", // Half Day
  //   inTime: "09:20:00",
  //   outTime: "13:50:00",
  //   workMode: "Office",
  //   todayWork: "Conducted review of backend payroll calculation routines.",
  //   pendingWork: "Implement automated Professional Tax deductions logic.",
  //   issuesFaced: "Left early due to dental checkup."
  // },
  //   {
  //   employeeCode: "IA00142",
  //   date: "2026-05-04",
  //   status: "Half", // Half Day
  //   inTime: "09:20:00",
  //   outTime: "13:50:00",
  //   workMode: "Office",
  //   todayWork: "Conducted review of backend payroll calculation routines.",
  //   pendingWork: "Implement automated Professional Tax deductions logic.",
  //   issuesFaced: "Left early due to dental checkup."
  // },
  //   {
  //   employeeCode: "IA00142",
  //   date: "2026-05-05",
  //   status: "Half", // Half Day
  //   inTime: "09:20:00",
  //   outTime: "13:50:00",
  //   workMode: "Office",
  //   todayWork: "Conducted review of backend payroll calculation routines.",
  //   pendingWork: "Implement automated Professional Tax deductions logic.",
  //   issuesFaced: "Left early due to dental checkup."
  // },
  //     {
  //   employeeCode: "IA00117",
  //   date: "2026-05-19",
  //   status: "Half", // Half Day
  //   inTime: "09:20:00",
  //   outTime: "13:50:00",
  //   workMode: "Office",
  //   todayWork: "Conducted review of backend payroll calculation routines.",
  //   pendingWork: "Implement automated Professional Tax deductions logic.",
  //   issuesFaced: "Left early due to dental checkup."
  // },
  //     {
  //   employeeCode: "IA00142",
  //   date: "2026-05-07",
  //   status: "Half", // Half Day
  //   inTime: "09:20:00",
  //   outTime: "13:50:00",
  //   workMode: "Office",
  //   todayWork: "Conducted review of backend payroll calculation routines.",
  //   pendingWork: "Implement automated Professional Tax deductions logic.",
  //   issuesFaced: "Left early due to dental checkup."
  // },
  //     {
  //   employeeCode: "IA00092",
  //   date: "2026-05-12",
  //   status: "Half", // Half Day
  //   inTime: "09:20:00",
  //   outTime: "13:50:00",
  //   workMode: "Office",
  //   todayWork: "Conducted review of backend payroll calculation routines.",
  //   pendingWork: "Implement automated Professional Tax deductions logic.",
  //   issuesFaced: "Left early due to dental checkup."
  // },
  //     {
  //   employeeCode: "IA00092",
  //   date: "2026-05-15",
  //   status: "Half", // Half Day
  //   inTime: "09:20:00",
  //   outTime: "13:50:00",
  //   workMode: "Office",
  //   todayWork: "Conducted review of backend payroll calculation routines.",
  //   pendingWork: "Implement automated Professional Tax deductions logic.",
  //   issuesFaced: "Left early due to dental checkup."
  // },
  //       {
  //   employeeCode: "IA00004",
  //   date: "2026-06-01",
  //   status: "Half", // Half Day
  //   inTime: "09:20:00",
  //   outTime: "13:50:00",
  //   workMode: "Office",
  //   todayWork: "Conducted review of backend payroll calculation routines.",
  //   pendingWork: "Implement automated Professional Tax deductions logic.",
  //   issuesFaced: "Left early due to dental checkup."
  // },
  
  
  // {
  //   employeeCode: "IA00093",
  //   date: "2026-05-14",
  //   status: "L", // Leave
  //   workMode: "Office"
  // },

  //   {
  //   employeeCode: "IA00145",
  //   date: "2026-05-15",
  //   status: "L", // Leave
  //   // workMode: "Office"
  // },
  //     {
  //   employeeCode: "IA00145",
  //   date: "2026-05-16",
  //   status: "L", // Leave
  //   // workMode: "Office"
  // },
  //     {
  //   employeeCode: "IA00145",
  //   date: "2026-05-18",
  //   status: "L", // Leave
  //   // workMode: "Office"
  // },
  //     {
  //   employeeCode: "IA00145",
  //   date: "2026-05-19",
  //   status: "L", // Leave
  //   // workMode: "Office"
  // },
  //     {
  //   employeeCode: "IA00117",
  //   date: "2026-05-05",
  //   status: "A", // Leave
  //   // workMode: "Office"
  // },

  // {
  //   employeeCode: "IA00117",
  //   date: "2026-05-06",
  //   status: "A", // Leave
  //   // workMode: "Office"
  // },
  // {
  //   employeeCode: "IA00117",
  //   date: "2026-05-08",
  //   status: "A", // Leave
  //   // workMode: "Office"
  // },
  //   {
  //   employeeCode: "IA00117",
  //   date: "2026-05-09",
  //   status: "A", // Leave
  //   // workMode: "Office"
  // },
  //   {
  //   employeeCode: "IA00117",
  //   date: "2026-05-10",
  //   status: "A", // Leave
  //   // workMode: "Office"
  // },
  //     {
  //   employeeCode: "IA00117",
  //   date: "2026-05-11",
  //   status: "A", // Leave
  //   // workMode: "Office"
  // },
  //     {
  //   employeeCode: "IA00117",
  //   date: "2026-05-13",
  //   status: "A", // Leave
  //   // workMode: "Office"
  // },
  //       {
  //   employeeCode: "IA00117",
  //   date: "2026-05-14",
  //   status: "A", // Leave
  //   // workMode: "Office"
  // },





  // {
  //   employeeCode: "IA00117",
  //   date: "2026-04-24",
  //   status: "P",
  //   inTime: "09:25:00",
  //   outTime: "18:30:00",
  //   workMode: "Office",
  //   todayWork: "Finalized past date selection for comp-offs and paid leaves.",
  //   pendingWork: "Perform full end-to-end integration tests on staging cluster.",
  //   issuesFaced: "None"
  // },
  // {
  //   employeeCode: "IA00114",
  //   date: "2026-05-11",
  //   status: "Coff", // Comp-Off
  //   workMode: "Office"
  // },


  // {
  //   employeeCode: "IA00117",
  //   date: "2026-04-26",
  //   status: "WO", // Week-Off (Sunday)
  //   workMode: "Office"
  // }
];

// ─────────────────────────────────────────────────────────────────────────────
// TIMING CONSTANTS & GEOLOCATION DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────----

const IST_OFFSET_HOURS = 5;
const IST_OFFSET_MINUTES = 30;
const DEFAULT_SHIFT_START_HOUR = 9;      // 09:30 AM IST shift start
const DEFAULT_SHIFT_START_MINUTE = 30;

// Geolocation default coordinates
const CHECK_IN_LAT = 18.5339786;
const CHECK_IN_LNG = 73.8395425;
const CHECK_OUT_LAT = 18.5339786;
const CHECK_OUT_LNG = 73.8395425;

// Valid Attendance Status enum
const VALID_STATUSES = ['P', 'A', 'WO', 'L', 'Coff', 'AUTO', 'H', 'Half'];

// ─────────────────────────────────────────────────────────────────────────────
// TIME & DATE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses YYYY-MM-DD string to strictly normalized UTC Midnight Date object.
 * This guarantees consistency independent of server/local execution timezones.
 */
const parseDateToUTC = (dateStr) => {
  if (!dateStr) return null;
  const parts = dateStr.trim().split('-');
  if (parts.length !== 3) return null;

  const yyyy = parseInt(parts[0], 10);
  const MM = parseInt(parts[1], 10) - 1; // 0-indexed
  const dd = parseInt(parts[2], 10);

  return new Date(Date.UTC(yyyy, MM, dd, 0, 0, 0, 0));
};

/**
 * Combines an IST time string (HH:MM:SS) with base UTC date and 
 * adjusts by Indian Standard Time offset (+5:30) to retrieve exact UTC moment.
 */
const parseTimeOnDateIST = (timeStr, baseDate) => {
  if (!timeStr || !baseDate) return null;

  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;

  const hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const seconds = parseInt(m[3] || '0', 10);

  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  const yyyy = baseDate.getUTCFullYear();
  const MM = baseDate.getUTCMonth();
  const dd = baseDate.getUTCDate();

  const utcHours = hours - IST_OFFSET_HOURS;
  const utcMinutes = minutes - IST_OFFSET_MINUTES;

  return new Date(Date.UTC(yyyy, MM, dd, utcHours, utcMinutes, seconds));
};

/**
 * Computes standard 09:30 AM shift start point for a given date in UTC.
 */
const getShiftStartUTC = (baseDate) => {
  return parseTimeOnDateIST(
    `${DEFAULT_SHIFT_START_HOUR}:${DEFAULT_SHIFT_START_MINUTE}:00`,
    baseDate
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE SEEDER FUNCTION
// ─────────────────────────────────────────────────────────────────────────────
const seedAttendanceFromJson = async () => {
  logger.info('🚀 Starting JSON-driven Attendance Database Seeding...');

  let connectionOpenedLocally = false;
  try {
    // 1. Establish Database Connection if not already opened
    if (mongoose.connection.readyState === 0) {
      await connectDB();
      connectionOpenedLocally = true;
      logger.info('🔌 Established database connection.');
    }

    // 2. Cache Active Employees
    const activeEmployees = await Employee.find({}, { _id: 1, employeeCode: 1, name: 1 }).lean();
    const employeeMap = new Map();
    activeEmployees.forEach(emp => {
      employeeMap.set(emp.employeeCode.toUpperCase(), { id: emp._id, name: emp.name });
    });
    logger.info(`👥 Successfully cached ${employeeMap.size} database employees.`);

    // 3. Compile and Validate JSON input
    const bulkOps = [];
    const affectedEmployees = new Set();
    const affectedMonths = new Set(); // Stores unique "employeeId|YYYY-MM" strings for payroll sync

    let processedCount = 0;
    let skippedBadDate = 0;
    let skippedNoCode = 0;
    let skippedUnknownEmp = 0;
    let skippedBadStatus = 0;

    for (const record of ATTENDANCE_JSON_DATA) {
      const code = record.employeeCode ? record.employeeCode.trim().toUpperCase() : '';
      if (!code) {
        logger.warn('⏭️ Skipped entry: Missing employeeCode.');
        skippedNoCode++;
        continue;
      }

      const date = parseDateToUTC(record.date);
      if (!date) {
        logger.warn(`⏭️ Skipped [${code}]: Invalid/Missing date format (${record.date}). Expected YYYY-MM-DD.`);
        skippedBadDate++;
        continue;
      }

      const empInfo = employeeMap.get(code);
      if (!empInfo) {
        logger.warn(`⏭️ Skipped [${code}]: Employee code not found in current database.`);
        skippedUnknownEmp++;
        continue;
      }

      // Enforce status validation
      const status = record.status ? record.status.trim() : 'P';
      if (!VALID_STATUSES.includes(status)) {
        logger.warn(`⏭️ Skipped [${code}] on date [${record.date}]: Invalid status "${status}".`);
        skippedBadStatus++;
        continue;
      }

      // Parse absolute Check-In and Check-Out times in IST
      const inTime = parseTimeOnDateIST(record.inTime, date);
      const outTime = parseTimeOnDateIST(record.outTime, date);

      // Compute worked duration (hours and minutes)
      let totalMinutes = 0;
      let totalHours = 0;
      if (inTime && outTime && outTime > inTime) {
        const diffMs = outTime.getTime() - inTime.getTime();
        totalMinutes = Math.floor(diffMs / 60000);
        totalHours = parseFloat((totalMinutes / 60).toFixed(2));
      } else if (status === 'Half') {
        // Enforce fallback total hours for half day if times not provided
        totalHours = 4.5;
        totalMinutes = 270;
      }

      // Compute late minutes based on 9:30 AM shift start
      let isLate = false;
      let lateMinutes = 0;
      if (inTime && (status === 'P' || status === 'Half')) {
        const shiftStart = getShiftStartUTC(date);
        if (shiftStart) {
          const diffMs = inTime.getTime() - shiftStart.getTime();
          if (diffMs > 0) {
            isLate = true;
            lateMinutes = Math.floor(diffMs / 60000);
          }
        }
      }

      // Normalize workMode input
      const resolvedWorkMode = (record.workMode && ['Office', 'Field', 'WFH'].includes(record.workMode))
        ? record.workMode
        : 'Office';

      // Build structured model record
      const attendanceDoc = {
        employeeId: empInfo.id,
        employeeCode: code,
        employeeName: empInfo.name,
        date,
        inTime: (status === 'P' || status === 'Half') ? inTime : undefined,
        outTime: (status === 'P' || status === 'Half') ? outTime : undefined,
        totalHours,
        totalMinutes,
        status,
        isLate,
        lateMinutes,
        isGeoAttendance: true,
        checkInLatitude: CHECK_IN_LAT,
        checkInLongitude: CHECK_IN_LNG,
        checkOutLatitude: CHECK_OUT_LAT,
        checkOutLongitude: CHECK_OUT_LNG,
        workMode: resolvedWorkMode,
        todayWork: record.todayWork || '',
        pendingWork: record.pendingWork || '',
        issuesFaced: record.issuesFaced || '',
        correctionRequested: false,
        correctionStatus: 'None'
      };

      // Perform bulk upsert (update if exists, insert if new) to fully prevent duplicates
      bulkOps.push({
        updateOne: {
          filter: { employeeCode: code, date },
          update: { $set: attendanceDoc },
          upsert: true
        }
      });

      // Register affected scope for payroll updates
      affectedEmployees.add(empInfo.id.toString());
      const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      affectedMonths.add(`${empInfo.id.toString()}|${monthKey}`);

      processedCount++;
      logger.info(`✅ Prepared [${code}] for date [${record.date}] - Status: ${status}, Late: ${lateMinutes}m, Worked: ${totalHours}h`);
    }

    logger.info(`
📋 PRE-PROCESSING BATCH SUMMARY:
   - Total Entries Received : ${ATTENDANCE_JSON_DATA.length}
   - Prepared to Upsert    : ${processedCount}
   - Skipped (No Code)     : ${skippedNoCode}
   - Skipped (Bad Date)    : ${skippedBadDate}
   - Skipped (Bad Status)  : ${skippedBadStatus}
   - Skipped (Unknown Emp) : ${skippedUnknownEmp}
`);

    if (bulkOps.length === 0) {
      logger.warn('⚠️ No valid attendance records prepared. Seeding aborted.');
      if (connectionOpenedLocally) {
        await mongoose.disconnect();
      }
      process.exit(0);
    }

    // 4. Execute Bulk Write Database Operations
    logger.info(`💾 Executing bulk database operations...`);
    const results = await Attendance.bulkWrite(bulkOps, { ordered: false });

    logger.info(`
🎉 SEEDING TRANSACTION COMPLETED:
   - Matched Records  : ${results.nMatched || 0}
   - Inserted (New)   : ${results.nInserted || 0}
   - Upserted (Update): ${results.nUpserted || 0}
   - Modified         : ${results.nModified || 0}
`);

    // 5. Automated Cross-Module Synchronisation with Payroll
    logger.info('🪙 Synchronizing changes with the Payroll Module...');
    for (const key of affectedMonths) {
      const [empIdStr, yyyyMm] = key.split('|');
      const [yearStr, monthStr] = yyyyMm.split('-');

      const targetMonth = parseInt(monthStr, 10);
      const targetYear = parseInt(yearStr, 10);

      // Query active payroll statements for the target period
      const payrolls = await Payroll.find({
        employeeId: empIdStr,
        month: targetMonth,
        year: targetYear
      });

      for (const pr of payrolls) {
        logger.info(`   🔄 Reprocessing Payroll for Employee [${pr.employeeCode}] during cycle: ${pr.fromDate.toDateString()} - ${pr.toDate.toDateString()}...`);
        await processSingleEmployeePayroll({
          employeeId: pr.employeeId,
          fromDate: pr.fromDate,
          toDate: pr.toDate,
          targetMonth: pr.month,
          targetYear: pr.year,
          processedBy: new mongoose.Types.ObjectId(empIdStr)
        });
      }
    }
    logger.info('🎉 Payroll Module successfully synchronized with seeded attendance records!');

    if (connectionOpenedLocally) {
      await mongoose.disconnect();
      logger.info('🔌 Disconnected database connection.');
    }

    logger.info('🏁 Attendance seed completed successfully!');
    process.exit(0);
  } catch (err) {
    logger.error(`❌ Seeding failed: ${err.message}`);
    logger.error(err.stack);
    if (connectionOpenedLocally) {
      try {
        await mongoose.disconnect();
      } catch (discErr) {
        // ignore
      }
    }
    process.exit(1);
  }
};

// Start script execution
seedAttendanceFromJson();
