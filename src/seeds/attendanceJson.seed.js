/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PRODUCTION-GRADE ATTENDANCE SEED & IMPORT SYSTEM (JSON-DRIVEN)
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 * DESCRIPTION:
 * This script seeds/imports structured JSON-defined attendance records directly 
 * into the MongoDB database. It automatically calculates working hours, working 
 * minutes, lateness (against 09:30 AM IST shift), maps geographic check-in/out
 * points, prevents duplicate records by performing bulk upsert operations, 
 * and formats all datetime values properly under the nominal IST offset.
 *
 * EXECUTION GUIDE:
 * 1. Ensure your backend environment variables (.env) are configured properly.
 * 2. Run the script from the root project directory:
 *    node backend/src/seeds/attendanceJson.seed.js
 * 
 * PREREQUISITES:
 * - Active MongoDB connection.
 * - Matching employee records already pre-seeded in the 'Employee' collection.
 * 
 * ─────────────────────────────────────────────────────────────────────────────
 */

import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Attendance } from '../models/Attendance.model.js';
import { Employee } from '../models/Employee.model.js';
import { connectDB } from '../config/db.js';
import { logger } from '../utils/logger.js';

// Resolve directory paths for logging/context
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURABLE STRUCTURED ATTENDANCE DATA JSON
// Easily add, modify, or update records below.
// ─────────────────────────────────────────────────────────────────────────────
const ATTENDANCE_JSON_DATA = [
  {
    employeeCode: "IA00143",
    date: "2026-05-04",
    inTime: "09:15:00", // Present, On time
    outTime: "18:30:00",
    workMode: "Office",
    todayWork: "Designed dashboard interface and added premium animations.",
    pendingWork: "Finalize Excel download template styling integrations.",
    issuesFaced: "None"
  },
  // {
  //   employeeCode: "IA00001",
  //   date: "2026-05-18",
  //   inTime: "09:45:00", // Late (shift starts at 09:30 AM IST)
  //   outTime: "18:00:00",
  //   workMode: "Office",
  //   todayWork: "Configured backend API routing layers for special logins.",
  //   pendingWork: "Connect components to mock endpoints on mobile view.",
  //   issuesFaced: "Minor git merge conflicts resolved."
  // },
  // {
  //   employeeCode: "IA00002",
  //   date: "2026-05-18",
  //   inTime: "10:15:00", // Late (shift starts at 09:30 AM IST)
  //   outTime: "19:00:00",
  //   workMode: "Office",
  //   todayWork: "Implemented database indexing filters for attendance trends.",
  //   pendingWork: "Perform load tests and check execution profiles.",
  //   issuesFaced: "High CPU usage on sandbox DB investigated and indexed."
  // }
];

// ─────────────────────────────────────────────────────────────────────────────
// TIMING CONSTANTS & GEOLOCATION DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────
const IST_OFFSET_HOURS = 5;
const IST_OFFSET_MINUTES = 30;
const DEFAULT_SHIFT_START_HOUR = 9;      // 09:30 AM IST shift start
const DEFAULT_SHIFT_START_MINUTE = 30;

// Requested Geolocation coordinates
const CHECK_IN_LAT = 18.5339786;
const CHECK_IN_LNG = 73.8395425;
const CHECK_OUT_LAT = 18.5339786;
const CHECK_OUT_LNG = 73.8395425;

// ─────────────────────────────────────────────────────────────────────────────
// TIME & DATE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses YYYY-MM-DD string to midnight UTC Date object
 */
const parseDate = (dateStr) => {
  if (!dateStr) return null;
  const parts = dateStr.trim().split('-');
  if (parts.length !== 3) return null;
  
  const yyyy = parseInt(parts[0], 10);
  const MM = parseInt(parts[1], 10) - 1; // 0-indexed
  const dd = parseInt(parts[2], 10);
  
  return new Date(Date.UTC(yyyy, MM, dd, 0, 0, 0, 0));
};

/**
 * Combines an IST time string (HH:MM:SS) with base midnight UTC date and
 * subtracts 5 hours 30 minutes to get the correct UTC moment.
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
 * Calculates default shift start for the date in UTC
 */
const getShiftStart = (baseDate) => {
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

    // 2. Fetch active employees to map code to ObjectId & Display Names
    const activeEmployees = await Employee.find({}, { _id: 1, employeeCode: 1, name: 1 }).lean();
    const employeeMap = new Map();
    activeEmployees.forEach(emp => {
      employeeMap.set(emp.employeeCode.toUpperCase(), { id: emp._id, name: emp.name });
    });
    logger.info(`👥 Successfully cached ${employeeMap.size} database employees.`);

    // 3. Compile raw JSON input into valid Attendance schema structure
    const bulkOps = [];
    let processedCount = 0;
    let skippedBadDate = 0;
    let skippedNoCode = 0;
    let skippedUnknownEmp = 0;

    for (const record of ATTENDANCE_JSON_DATA) {
      const code = record.employeeCode ? record.employeeCode.trim().toUpperCase() : '';
      if (!code) {
        logger.warn('⏭️ Skipped entry: Missing employeeCode.');
        skippedNoCode++;
        continue;
      }

      const date = parseDate(record.date);
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
      }

      // Compute late minutes based on 9:30 AM shift start
      let isLate = false;
      let lateMinutes = 0;
      if (inTime) {
        const shiftStart = getShiftStart(date);
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
        inTime,
        outTime,
        totalHours,
        totalMinutes,
        status: 'P', // Strictly Present as required
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

      // Perform upsert (update if exists, insert if new) to fully prevent duplicates
      bulkOps.push({
        updateOne: {
          filter: { employeeCode: code, date },
          update: { $set: attendanceDoc },
          upsert: true
        }
      });

      processedCount++;
      logger.info(`✅ Prepared [${code}] for date [${record.date}] - Late Mins: ${lateMinutes}, Total Hrs: ${totalHours}`);
    }

    logger.info(`
📋 PRE-PROCESSING BATCH SUMMARY:
   - Total Entries Received: ${ATTENDANCE_JSON_DATA.length}
   - Prepared to Upsert   : ${processedCount}
   - Skipped (No Code)    : ${skippedNoCode}
   - Skipped (Bad Date)   : ${skippedBadDate}
   - Skipped (Unknown Emp): ${skippedUnknownEmp}
`);

    if (bulkOps.length === 0) {
      logger.warn('⚠️ No valid attendance records prepared. Seeding aborted.');
      if (connectionOpenedLocally) {
        await mongoose.disconnect();
      }
      process.exit(0);
    }

    // 4. Execute Bulk Write Database Operations
    logger.info(`💾 Executing bulk database operations in chunks...`);
    const results = await Attendance.bulkWrite(bulkOps, { ordered: false });
    
    logger.info(`
🎉 SEEDING TRANSACTION COMPLETED:
   - Matched Records  : ${results.nMatched || 0}
   - Inserted (New)   : ${results.nInserted || 0}
   - Upserted (Update): ${results.nUpserted || 0}
   - Modified         : ${results.nModified || 0}
`);

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
