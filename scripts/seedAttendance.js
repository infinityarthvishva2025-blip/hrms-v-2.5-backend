import 'dotenv/config';
import mongoose from 'mongoose';
import xlsx from 'xlsx';

import { Employee } from '../src/models/Employee.model.js';
import { Attendance } from '../src/models/Attendance.model.js';
import { logger } from '../src/utils/logger.js';

// ---------------------------------------------------------------------
// DB CONNECTION
// ---------------------------------------------------------------------
const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  logger.info('✅ Connected to MongoDB');
};

// ---------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------

const parseExcelDate = (value) => {
  if (!value) return null;

  if (typeof value === 'number') {
    return new Date((value - 25569) * 86400 * 1000);
  }

  const d = new Date(value);
  return isNaN(d) ? null : d;
};

const toMidnight = (date) => {
  if (!date) return null;
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

// 🔥 STRONG TIME PARSER (handles 30:00.0 etc.)
const parseTime = (timeStr, baseDate) => {
  if (!timeStr || timeStr === 'NULL') return null;

  if (timeStr instanceof Date) return timeStr;

  try {
    let clean = String(timeStr).trim();

    // remove .0 → "30:00"
    clean = clean.replace('.0', '');

    const [h, m = 0, s = 0] = clean.split(':').map(Number);

    if (isNaN(h)) return null;

    const d = new Date(baseDate);
    d.setHours(h, m, s, 0);

    return d;
  } catch {
    return null;
  }
};

// Normalize status
const normalizeStatus = (status) => {
  if (!status) return 'P';

  const s = String(status).toUpperCase().trim();

  if (s === '½P' || s === 'HP') return 'P'; // or custom logic
  if (['P', 'A', 'WO', 'L', 'COFF', 'AUTO', 'H'].includes(s)) return s;

  return 'P';
};

// ---------------------------------------------------------------------
// EMPLOYEE CACHE (⚡ performance boost)
// ---------------------------------------------------------------------
let employeeMap = {};

const preloadEmployees = async () => {
  const employees = await Employee.find({}, { employeeCode: 1, name: 1 }).lean();

  employeeMap = {};
  for (const emp of employees) {
    employeeMap[emp.employeeCode] = emp;
  }

  logger.info(`👥 Loaded ${employees.length} employees`);
};

// ---------------------------------------------------------------------
// MAPPING FUNCTION
// ---------------------------------------------------------------------
const mapAttendanceRow = (row) => {
  const employeeCode = row.Emp_Code?.toString().trim().toUpperCase();

  if (!employeeCode) throw new Error('Missing employee code');

  const employee = employeeMap[employeeCode];
  if (!employee) throw new Error(`Employee not found: ${employeeCode}`);

  let date = parseExcelDate(row.Date || row.Att_Date);
  if (!date) throw new Error('Invalid date');

  date = toMidnight(date);

  const inTime = parseTime(row.InTime, date);
  const outTime = parseTime(row.OutTime, date);

  // 🔥 AUTO CALCULATE HOURS
  let totalMinutes = 0;
  let totalHours = 0;

  if (inTime && outTime) {
    totalMinutes = Math.max(0, (outTime - inTime) / 60000);
    totalHours = +(totalMinutes / 60).toFixed(2);
  }

  return {
    employeeId: employee._id,
    employeeCode,
    employeeName: employee.name,
    date,
    inTime,
    outTime,
    totalMinutes,
    totalHours,
    status: normalizeStatus(row.Status),
    isLate: row.IsLate === true || row.IsLate === 'TRUE',
    lateMinutes: Number(row.LateMinutes) || 0,
    isGeoAttendance: false,
    correctionStatus: 'None',
    isCompOffCredited: false,
  };
};

// ---------------------------------------------------------------------
// MAIN FUNCTION (🔥 BULK INSERT)
// ---------------------------------------------------------------------
const seedAttendance = async () => {
  try {
    await connectDB();
    await preloadEmployees();

    const workbook = xlsx.readFile('./src/attendance.xlsx');
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet);

    logger.info(`📊 Total rows: ${rows.length}`);

    const bulkOps = [];
    let failed = 0;

    for (const row of rows) {
      try {
        const doc = mapAttendanceRow(row);

        // 🔥 UPSERT (NO DUPLICATE ERROR EVER)
        bulkOps.push({
          updateOne: {
            filter: {
              employeeCode: doc.employeeCode,
              date: doc.date,
            },
            update: { $set: doc },
            upsert: true,
          },
        });

      } catch (err) {
        failed++;
        logger.error(`❌ Row failed (${row.Emp_Code}): ${err.message}`);
      }
    }

    // 🔥 BULK EXECUTION
    if (bulkOps.length) {
      const result = await Attendance.bulkWrite(bulkOps, { ordered: false });

      logger.info('──────────── RESULT ────────────');
      logger.info(`✅ Inserted: ${result.upsertedCount}`);
      logger.info(`♻️ Updated: ${result.modifiedCount}`);
      logger.info(`❌ Failed rows: ${failed}`);
    }

    await mongoose.disconnect();
    logger.info('🔌 Disconnected');
    process.exit(0);

  } catch (err) {
    logger.error('❌ Fatal:', err);
    await mongoose.disconnect();
    process.exit(1);
  }
};

// RUN
seedAttendance();