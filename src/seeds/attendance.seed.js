import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Attendance } from '../models/Attendance.model.js';
import { Employee } from '../models/Employee.model.js';
import { connectDB } from '../config/db.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// STATUS NORMALIZER
// Schema enum: ['P', 'A', 'WO', 'L', 'Coff', 'AUTO', 'H']
// Excel has many additional variants — map them cleanly.
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_MAP = {
  'p':     'P',
  'a':     'A',
  'wo':    'WO',
  'l':     'L',
  'coff':  'Coff',
  'auto':  'AUTO',
  'h':     'H',
  // half-present / partial variants → Present
  '½p':    'P',
  'hp':    'P',
  'pp':    'P',
  '«p':    'P',
  // weekoff variants
  'wop':   'WO',   // Week Off + Present
  'wo½p':  'WO',
  'wo«p':  'WO',
  'woo':   'WO',
  'wo ':   'WO',   // trailing space guard
  // holiday / half-off
  'ho':    'H',
  // others
  'm':     'AUTO', // Manual / Machine
  't':     'P',    // Trainee present
  '-':     'A',    // dash means absent
  'null':  'A',
};

const normalizeStatus = (raw) => {
  if (!raw || raw === 'NULL' || raw === 'null') return 'A';
  const key = String(raw).trim().toLowerCase();
  return STATUS_MAP[key] || 'P'; // default to Present if unknown
};

// ─────────────────────────────────────────────────────────────────────────────
// DATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert Excel numeric serial OR a date string → midnight UTC JS Date.
 * Key: always floor the serial to strip the fractional time component
 * (Excel stores IST offset ~5.5h as fraction when exported from SQL).
 */
const parseExcelDate = (val) => {
  if (val === null || val === undefined || val === 'NULL' || val === '-' || val === 'null' || val === '0' || val === '') return null;

  if (typeof val === 'number') {
    const dateSerial = Math.floor(val); // ← strip fractional time
    const date = new Date((dateSerial - 25569) * 86400 * 1000); // midnight UTC
    if (isNaN(date.getTime())) return null;
    // Sanity check: reject dates before year 2000
    if (date.getFullYear() < 2000) return null;
    return date;
  }

  if (typeof val === 'string') {
    const clean = val.trim();
    if (!clean || clean === 'NULL' || clean === '-') return null;

    // DD-MM-YYYY or DD/MM/YYYY
    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(clean)) {
      const parts = clean.split(/[-/]/);
      const d = new Date(Date.UTC(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10)));
      if (isNaN(d.getTime()) || d.getFullYear() < 2000) return null;
      return d;
    }

    // YYYY-MM-DD (ISO-ish, e.g. '0026-03-22' from bad export)
    if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
      const year = parseInt(clean.substring(0, 4), 10);
      if (year < 2000) return null; // skip obviously corrupt rows
      const d = new Date(clean.substring(0, 10) + 'T00:00:00.000Z');
      return isNaN(d.getTime()) ? null : d;
    }

    // Generic fallback
    const d = new Date(clean);
    if (isNaN(d.getTime()) || d.getFullYear() < 2000) return null;
    return d;
  }

  return null;
};

/**
 * Parse a time-only string (HH:MM or HH:MM:SS) and combine with a base date.
 * Both the date and the stored time are treated in "nominal UTC" (no IST offset),
 * which matches how the Attendance model virtual formatters display them.
 *
 * @param {string} timeStr  e.g. "15:30:00" or "09:05"
 * @param {Date}   baseDate Midnight UTC date for that attendance day
 * @returns {Date|null}
 */
const parseTimeOnDate = (timeStr, baseDate) => {
  if (!timeStr || timeStr === 'NULL' || timeStr === '-' || timeStr === 'null' || timeStr === '0') return null;
  if (typeof timeStr !== 'string') return null;
  if (!baseDate) return null;

  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;

  const hours   = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const seconds = parseInt(m[3] || '0', 10);

  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  // baseDate is guaranteed to be midnight UTC of the correct date
  const yyyy = baseDate.getUTCFullYear();
  const MM = String(baseDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(baseDate.getUTCDate()).padStart(2, '0');
  
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  // Construct standard date in Local Timezone (by omitting 'Z')
  const localDate = new Date(`${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}`);
  
  // fallback if new Date() fails for some extreme edge case
  if (isNaN(localDate.getTime())) {
    const fallback = new Date(baseDate);
    fallback.setHours(hours, minutes, seconds, 0);
    return fallback;
  }

  return localDate;
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────────────────
const cleanStr = (val) => {
  if (val === undefined || val === null || val === 'NULL' || val === '-' || val === 'null' || val === '0') return undefined;
  const s = String(val).trim();
  return s === '' ? undefined : s;
};

const toBool = (val) => {
  return val === 1 || val === '1' || val === true || val === 'true';
};

const toNum = (val) => {
  const n = Number(val);
  return isNaN(n) ? undefined : n;
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SEEDER
// ─────────────────────────────────────────────────────────────────────────────
const seedAttendance = async () => {
  try {
    await connectDB();

    const filePath = path.join(__dirname, '..', 'attendance1.3.xlsx');
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    // raw:false → keeps dates as strings where applicable; raw:true gives numeric serials for Date
    const data = xlsx.utils.sheet_to_json(worksheet, { raw: true, defval: 'NULL' });

    logger.info(`📂 Found ${data.length} rows in Excel.`);

    // ── Load all employees into memory ──────────────────────────────────────
    const employees = await Employee.find({}, { _id: 1, employeeCode: 1, name: 1 }).lean();
    const employeeMap = new Map();
    employees.forEach(emp => {
      employeeMap.set(emp.employeeCode.toUpperCase(), { id: emp._id, name: emp.name });
    });
    logger.info(`👥 Cached ${employeeMap.size} employees.`);

    // ── Load existing records for deduplication ──────────────────────────────
    logger.info('🔍 Fetching existing attendance records for deduplication...');
    const existingRecords = await Attendance.find({}, { employeeCode: 1, date: 1 }).lean();
    const existingSet = new Set(
      existingRecords.map(r => {
        const d = new Date(r.date);
        // Normalise to midnight UTC for comparison
        const midnight = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        return `${r.employeeCode.toUpperCase()}_${midnight.toISOString()}`;
      })
    );
    logger.info(`📊 ${existingSet.size} existing records loaded.`);

    const toInsert = [];
    let skippedNoCode   = 0;
    let skippedBadDate  = 0;
    let skippedDuplicate = 0;
    let skippedNoEmp    = 0;

    for (const row of data) {
      // ── Employee Code ──────────────────────────────────────────────────────
      const employeeCode = cleanStr(row.Emp_Code)?.toUpperCase();
      if (!employeeCode) { skippedNoCode++; continue; }

      // ── Date (normalized to midnight UTC) ─────────────────────────────────
      const date = parseExcelDate(row.Date);
      if (!date) { skippedBadDate++; continue; }

      // ── Deduplication ─────────────────────────────────────────────────────
      const dedupeKey = `${employeeCode}_${date.toISOString()}`;
      if (existingSet.has(dedupeKey)) { skippedDuplicate++; continue; }

      // ── Employee lookup ────────────────────────────────────────────────────
      const empInfo = employeeMap.get(employeeCode);
      if (!empInfo) { skippedNoEmp++; continue; }

      // ── InTime / OutTime ───────────────────────────────────────────────────
      const inTime  = parseTimeOnDate(row.InTime,  date);
      const outTime = parseTimeOnDate(row.OutTime, date);

      // ── Compute totalHours & totalMinutes ──────────────────────────────────
      let totalHours   = toNum(row.Total_Hours);
      let totalMinutes;
      if (inTime && outTime && outTime > inTime) {
        const diffMs = outTime.getTime() - inTime.getTime();
        totalMinutes = Math.floor(diffMs / 60000);
        totalHours   = parseFloat((totalMinutes / 60).toFixed(2));
      } else if (totalHours !== undefined) {
        totalMinutes = Math.round(totalHours * 60);
      }

      // ── Status (normalized to schema enum) ────────────────────────────────
      const status = normalizeStatus(row.Status);

      // ── Build record ───────────────────────────────────────────────────────
      const attendanceData = {
        employeeId:          empInfo.id,
        employeeCode:        employeeCode,
        employeeName:        empInfo.name,
        date,
        ...(inTime  ? { inTime }  : {}),
        ...(outTime ? { outTime } : {}),
        ...(totalHours   !== undefined ? { totalHours }   : {}),
        ...(totalMinutes !== undefined ? { totalMinutes } : {}),
        status,
        isLate:      toBool(row.IsLate),
        lateMinutes: toNum(row.LateMinutes) ?? 0,

        isGeoAttendance: toBool(row.IsGeoAttendance),
        ...(cleanStr(row.CheckInLatitude)   ? { checkInLatitude:   Number(row.CheckInLatitude)   } : {}),
        ...(cleanStr(row.CheckInLongitude)  ? { checkInLongitude:  Number(row.CheckInLongitude)  } : {}),
        ...(cleanStr(row.CheckOutLatitude)  ? { checkOutLatitude:  Number(row.CheckOutLatitude)  } : {}),
        ...(cleanStr(row.CheckOutLongitude) ? { checkOutLongitude: Number(row.CheckOutLongitude) } : {}),

        correctionRequested:  toBool(row.CorrectionRequested),
        correctionStatus:     cleanStr(row.CorrectionStatus) || 'None',
        ...(cleanStr(row.CorrectionRemark) ? { correctionReason: cleanStr(row.CorrectionRemark) } : {}),
        ...(parseExcelDate(row.CorrectionRequestedOn) ? { correctionRequestedOn: parseExcelDate(row.CorrectionRequestedOn) } : {}),

        isCompOffCredited: toBool(row.IsCompOffCredited),
      };

      toInsert.push(attendanceData);
      existingSet.add(dedupeKey); // prevent same-file duplicates
    }

    logger.info(`
📋 Parse Summary:
   ✅ Ready to insert : ${toInsert.length}
   ⏭  Skipped (no code): ${skippedNoCode}
   ⏭  Skipped (bad date): ${skippedBadDate}
   ⏭  Skipped (duplicate): ${skippedDuplicate}
   ⏭  Skipped (unknown emp): ${skippedNoEmp}
`);

    if (toInsert.length === 0) {
      const finalCount = await Attendance.countDocuments();
      logger.info(`⚠️  No new records to insert. DB count: ${finalCount}`);
      process.exit(0);
    }

    // ── Batch insert ───────────────────────────────────────────────────────
    const CHUNK = 500;
    let totalInserted = 0;
    let totalErrors   = 0;

    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunk = toInsert.slice(i, i + CHUNK);
      try {
        const result = await Attendance.insertMany(chunk, { ordered: false });
        totalInserted += result.length;
      } catch (bulkErr) {
        const inserted = bulkErr.result?.nInserted ?? 0;
        const errors   = bulkErr.result?.writeErrors?.length ?? 0;
        totalInserted += inserted;
        totalErrors   += errors;

        if (errors > 0) {
          const sample = bulkErr.result?.writeErrors?.slice(0, 3) || [];
          sample.forEach(e => logger.warn(`  Bulk error [${e.index}]: ${e.errmsg}`));
        }
      }

      const pct = Math.round(((i + chunk.length) / toInsert.length) * 100);
      logger.info(`⏳ Progress: ${Math.min(i + CHUNK, toInsert.length)} / ${toInsert.length} (${pct}%)`);
    }

    const finalCount = await Attendance.countDocuments();
    logger.info(`
✅ Seeding complete!
   Inserted this run : ${totalInserted}
   Write errors      : ${totalErrors}
   Total in DB now   : ${finalCount}
`);
    process.exit(0);
  } catch (error) {
    logger.error(`❌ Seeding failed: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  }
};

seedAttendance();
