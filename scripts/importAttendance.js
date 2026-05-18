import 'dotenv/config';
import mongoose from 'mongoose';
import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Employee } from '../src/models/Employee.model.js';
import { Attendance } from '../src/models/Attendance.model.js';
import { logger } from '../src/utils/logger.js';
import { config } from '../src/config/index.js';
import { evaluateWorkingMinutes } from '../src/utils/attendanceHelper.js';

// Setup file paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION & CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const IST_OFFSET_HOURS = 5;
const IST_OFFSET_MINUTES = 30;
const DEFAULT_SHIFT_START_HOUR = 9;      // 09:30 AM IST
const DEFAULT_SHIFT_START_MINUTE = 30;

const DEFAULT_GEO_LAT = config.office?.latitude || 18.534202;
const DEFAULT_GEO_LNG = config.office?.longitude || 73.839556;

// Valid Schema Enums
const VALID_STATUSES = ['P', 'A', 'WO', 'L', 'Coff', 'AUTO', 'H', 'Half'];

// Status Normalizer Mapping
const STATUS_MAP = {
  'p':     'P',
  'a':     'A',
  'wo':    'WO',
  'l':     'L',
  'coff':  'Coff',
  'auto':  'AUTO',
  'h':     'H',
  '½p':    'P',
  'hp':    'P',
  'pp':    'P',
  '«p':    'P',
  'wop':   'WO',
  'wo½p':  'WO',
  'wo«p':  'WO',
  'woo':   'WO',
  'wo ':   'WO',
  'ho':    'H',
  'm':     'AUTO',
  't':     'P',
  '-':     'A',
  'null':  'A',
};

const normalizeStatus = (raw, hasTimes) => {
  if (!raw || raw === 'NULL' || raw === 'null') {
    return hasTimes ? 'P' : 'A';
  }
  const key = String(raw).trim().toLowerCase();
  return STATUS_MAP[key] || 'P';
};

// Robust Key Mapper for flexible Column Headers
const COLUMN_MAPPINGS = {
  employeeCode: ['Emp_Code', 'Emp Code', 'EmployeeCode', 'Employee Code', 'Code', 'Employee_Code'],
  date:         ['Date', 'Att_Date', 'Att Date', 'Attendance Date', 'Day', 'Attendance_Date'],
  status:       ['Status', 'Att_Status', 'Att Status', 'Attendance Status', 'Attendance_Status'],
  inTime:       ['InTime', 'In Time', 'In_Time', 'CheckIn', 'Check In', 'In', 'Check_In'],
  outTime:      ['OutTime', 'Out Time', 'Out_Time', 'CheckOut', 'Check Out', 'Out', 'Check_Out'],
};

const getRowValue = (row, possibleKeys) => {
  for (const key of possibleKeys) {
    const variants = [
      key,
      key.toLowerCase(),
      key.toUpperCase(),
      key.replace(/_/g, ' '),
      key.replace(/ /g, '_'),
      key.replace(/\s+/g, '')
    ];
    for (const v of variants) {
      if (row[v] !== undefined && row[v] !== null && String(row[v]).trim() !== '') {
        return row[v];
      }
    }
  }
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// PARSING HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const parseExcelDate = (val) => {
  if (val === null || val === undefined || val === 'NULL' || val === '-' || val === 'null' || val === '0' || val === '') return null;

  if (typeof val === 'number') {
    const dateSerial = Math.floor(val);
    const date = new Date((dateSerial - 25569) * 86400 * 1000); // midnight UTC
    if (isNaN(date.getTime()) || date.getFullYear() < 2000) return null;
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

    // YYYY-MM-DD (ISO)
    if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
      const year = parseInt(clean.substring(0, 4), 10);
      if (year < 2000) return null;
      const d = new Date(clean.substring(0, 10) + 'T00:00:00.000Z');
      return isNaN(d.getTime()) ? null : d;
    }

    // Generic Date parse
    const d = new Date(clean);
    if (isNaN(d.getTime()) || d.getFullYear() < 2000) return null;
    // Normalize to midnight UTC
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }

  return null;
};

const parseTimeOnDateIST = (timeVal, baseDate) => {
  if (timeVal === null || timeVal === undefined || timeVal === 'NULL' || timeVal === '-' || timeVal === 'null' || timeVal === '0') return null;
  if (!baseDate) return null;

  let hours = 0, minutes = 0, seconds = 0;

  if (timeVal instanceof Date) {
    hours = timeVal.getHours();
    minutes = timeVal.getMinutes();
    seconds = timeVal.getSeconds();
  } else if (typeof timeVal === 'number') {
    // Excel numeric fraction representation of time (e.g. 0.5 = 12:00:00)
    const totalSeconds = Math.round(timeVal * 24 * 60 * 60);
    hours = Math.floor(totalSeconds / 3600);
    minutes = Math.floor((totalSeconds % 3600) / 60);
    seconds = totalSeconds % 60;
  } else if (typeof timeVal === 'string') {
    const clean = String(timeVal).trim().replace('.0', '');
    const m = clean.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;

    hours = parseInt(m[1], 10);
    minutes = parseInt(m[2], 10);
    seconds = parseInt(m[3] || '0', 10);
  } else {
    return null;
  }

  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  // baseDate is midnight UTC of the correct date
  const yyyy = baseDate.getUTCFullYear();
  const MM   = baseDate.getUTCMonth(); // 0-based
  const dd   = baseDate.getUTCDate();

  // Convert IST to UTC by subtracting offset (5h 30m)
  const utcHours = hours - IST_OFFSET_HOURS;
  const utcMinutes = minutes - IST_OFFSET_MINUTES;

  const utcDate = new Date(Date.UTC(yyyy, MM, dd, utcHours, utcMinutes, seconds));
  return isNaN(utcDate.getTime()) ? null : utcDate;
};

const getShiftStartUTC = (baseDate) => {
  if (!baseDate) return null;
  return parseTimeOnDateIST(
    `${DEFAULT_SHIFT_START_HOUR}:${DEFAULT_SHIFT_START_MINUTE}:00`,
    baseDate
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT FLOW
// ─────────────────────────────────────────────────────────────────────────────

const importAttendance = async () => {
  const fileArg = process.argv[2];
  const defaultPath = './attendance_import.xlsx';
  const filePath = fileArg ? path.resolve(fileArg) : path.resolve(defaultPath);

  logger.info(`🚀 Starting Bulk Attendance Import from: ${filePath}`);

  // Validate File Exists
  if (!fs.existsSync(filePath)) {
    logger.error(`❌ File not found at path: ${filePath}`);
    logger.info(`💡 Please provide the file path as an argument. Example: node scripts/importAttendance.js /path/to/file.xlsx`);
    process.exit(1);
  }

  // Connect to DB
  try {
    const dbUri = config.mongoUri;
    await mongoose.connect(dbUri);
    logger.info(`🔋 Connected to Database cleanly`);
  } catch (dbErr) {
    logger.error(`❌ Failed to connect to MongoDB: ${dbErr.message}`);
    process.exit(1);
  }

  // Seeding Statistics Counters
  const auditLogs = {
    successfulUpserts: [],
    missingEmployees: [],
    invalidRows: [],
    duplicateFileEntries: [],
    failedDBWrites: [],
  };

  try {
    // Cache all Employees in Memory for ultra-high speed lookups (O(1))
    const employees = await Employee.find({}, { _id: 1, employeeCode: 1, name: 1 }).lean();
    const employeeMap = new Map();
    for (const emp of employees) {
      employeeMap.set(emp.employeeCode.toUpperCase(), { id: emp._id, name: emp.name });
    }
    logger.info(`Cached ${employeeMap.size} employee profiles for O(1) matching`);

    // Parse Excel Workbook
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData = xlsx.utils.sheet_to_json(worksheet, { raw: true, defval: '' });

    logger.info(`📊 Parsing ${rawData.length} rows from Excel sheet [${sheetName}]...`);

    const bulkOps = [];
    const localDeDuplicationSet = new Set();

    let rowIndex = 1; // 1-based tracking matching Excel rows (row 1 is header, data starts at index 2)
    
    for (const row of rawData) {
      rowIndex++; // increment for current data row

      // 1. Resolve Columns with Flexible Headers
      const rawCode = getRowValue(row, COLUMN_MAPPINGS.employeeCode);
      const rawDate = getRowValue(row, COLUMN_MAPPINGS.date);
      const rawStatus = getRowValue(row, COLUMN_MAPPINGS.status);
      const rawInTime = getRowValue(row, COLUMN_MAPPINGS.inTime);
      const rawOutTime = getRowValue(row, COLUMN_MAPPINGS.outTime);

      const cleanCode = rawCode ? String(rawCode).trim().toUpperCase() : null;

      // 2. Validate Code Format (e.g., matching IA00000 format)
      if (!cleanCode) {
        auditLogs.invalidRows.push({
          rowIndex,
          rowData: row,
          reason: 'Missing Employee Code (Emp_Code)',
        });
        continue;
      }

      const companyPrefix = config.company?.prefix || 'IA';
      const codeRegex = new RegExp(`^${companyPrefix}\\d{5}$`);
      if (!codeRegex.test(cleanCode)) {
        auditLogs.invalidRows.push({
          rowIndex,
          rowData: row,
          reason: `Invalid Employee Code format: '${cleanCode}'. Must match ${companyPrefix} followed by 5 digits (e.g., ${companyPrefix}00004).`,
        });
        continue;
      }

      // 3. Parse Date to Midnight UTC
      const date = parseExcelDate(rawDate);
      if (!date) {
        auditLogs.invalidRows.push({
          rowIndex,
          rowData: row,
          reason: `Invalid or unparseable Date: '${rawDate}'. Must be YYYY-MM-DD or DD-MM-YYYY format.`,
        });
        continue;
      }

      // 4. File-Level Deduplication (check if same Employee + Date combination is defined multiple times in this excel)
      const dedupeKey = `${cleanCode}_${date.toISOString()}`;
      if (localDeDuplicationSet.has(dedupeKey)) {
        auditLogs.duplicateFileEntries.push({
          empCode: cleanCode,
          date: date.toISOString().split('T')[0],
          rowIndex,
          rowData: row,
        });
        continue;
      }
      localDeDuplicationSet.add(dedupeKey);

      // 5. Database Employee Check
      const dbEmp = employeeMap.get(cleanCode);
      if (!dbEmp) {
        auditLogs.missingEmployees.push({
          empCode: cleanCode,
          rowIndex,
          rowData: row,
        });
        continue;
      }

      // 6. Times Calculation & Standard Status Mappings
      const inTime = parseTimeOnDateIST(rawInTime, date);
      const outTime = parseTimeOnDateIST(rawOutTime, date);
      let status = normalizeStatus(rawStatus, !!inTime);

      // Skip invalid statuses
      if (!VALID_STATUSES.includes(status)) {
        auditLogs.invalidRows.push({
          rowIndex,
          rowData: row,
          reason: `Invalid attendance status parsed: '${status}'. Allowed statuses are: ${VALID_STATUSES.join(', ')}`,
        });
        continue;
      }

      let totalMinutes = 0;
      let totalHours = 0;
      let isLate = false;
      let lateMinutes = 0;

      // Calculate total working duration
      if (inTime && outTime) {
        if (outTime > inTime) {
          const diffMs = outTime.getTime() - inTime.getTime();
          totalMinutes = Math.floor(diffMs / 60000);
          totalHours = parseFloat((totalMinutes / 60).toFixed(2));

          // Apply working hours and grace rules to determine final status if status is 'P'
          if (status === 'P') {
            const evalResult = evaluateWorkingMinutes(date, totalMinutes);
            if (evalResult.isFullDay) {
              status = 'P';
            } else if (evalResult.isHalfDay) {
              status = 'Half';
            } else {
              status = 'A';
            }
          }
        } else {
          logger.warn(`Row ${rowIndex} (${cleanCode}): OutTime is earlier than or equal to InTime. Setting work duration to 0.`);
        }
      }

      // Calculate Lateness based on default shift time (09:30 AM IST)
      if (inTime && status === 'P') {
        const shiftStart = getShiftStartUTC(date);
        if (shiftStart) {
          const delayMs = inTime.getTime() - shiftStart.getTime();
          if (delayMs > 0) {
            isLate = true;
            lateMinutes = Math.floor(delayMs / 60000);
          }
        }
      }

      // 7. Map to existing schema model
      const attendanceDoc = {
        employeeId: dbEmp.id,
        employeeCode: cleanCode,
        employeeName: dbEmp.name,
        date,
        status,
        workMode: 'Office',
        isLate,
        lateMinutes,
        isGeoAttendance: false,
        checkInLatitude: DEFAULT_GEO_LAT,
        checkInLongitude: DEFAULT_GEO_LNG,
        checkOutLatitude: DEFAULT_GEO_LAT,
        checkOutLongitude: DEFAULT_GEO_LNG,
        correctionStatus: 'None',
        isCompOffCredited: false,
      };

      // Conditionally append times & calculations if applicable
      if (inTime) attendanceDoc.inTime = inTime;
      if (outTime) attendanceDoc.outTime = outTime;
      if (totalMinutes > 0) {
        attendanceDoc.totalMinutes = totalMinutes;
        attendanceDoc.totalHours = totalHours;
      }

      // Build High-Speed Upsert write operation
      bulkOps.push({
        updateOne: {
          filter: { employeeCode: cleanCode, date },
          update: { $set: attendanceDoc },
          upsert: true,
        },
        metadata: { cleanCode, date: date.toISOString().split('T')[0], status, inTime, outTime },
      });
    }

    logger.info(`✨ Successfully parsed all rows. Preparing to execute DB Bulk Writes for ${bulkOps.length} records...`);

    // 8. Execute high-performance bulk write operations
    if (bulkOps.length > 0) {
      // Split into chunks of 500 for optimal memory & network performance
      const CHUNK_SIZE = 500;
      let processedOps = 0;

      for (let i = 0; i < bulkOps.length; i += CHUNK_SIZE) {
        const chunk = bulkOps.slice(i, i + CHUNK_SIZE);
        // Exclude custom metadata field from mongoose write command
        const cleanChunk = chunk.map(op => ({ updateOne: op.updateOne }));

        try {
          const result = await Attendance.bulkWrite(cleanChunk, { ordered: false });
          processedOps += cleanChunk.length;

          // Track success details for audit logs
          chunk.forEach(op => {
            const meta = op.metadata;
            auditLogs.successfulUpserts.push({
              empCode: meta.cleanCode,
              date: meta.date,
              status: meta.status,
              inTime: meta.inTime ? meta.inTime.toISOString() : null,
              outTime: meta.outTime ? meta.outTime.toISOString() : null,
            });
          });

        } catch (bulkErr) {
          // In case of any individual write failures
          const errors = bulkErr.writeErrors || [];
          const successCount = cleanChunk.length - errors.length;
          processedOps += successCount;

          // Process write errors
          errors.forEach(err => {
            const failedOp = chunk[err.index];
            auditLogs.failedDBWrites.push({
              empCode: failedOp.metadata.cleanCode,
              date: failedOp.metadata.date,
              error: err.errmsg,
            });
          });

          // Process successful bulk writes in this chunk
          const failedIndices = new Set(errors.map(e => e.index));
          chunk.forEach((op, index) => {
            if (!failedIndices.has(index)) {
              const meta = op.metadata;
              auditLogs.successfulUpserts.push({
                empCode: meta.cleanCode,
                date: meta.date,
                status: meta.status,
                inTime: meta.inTime ? meta.inTime.toISOString() : null,
                outTime: meta.outTime ? meta.outTime.toISOString() : null,
              });
            }
          });
        }

        const progressPercent = Math.round((processedOps / bulkOps.length) * 100);
        logger.info(`⏳ DB Sync Progress: ${processedOps} / ${bulkOps.length} records processed (${progressPercent}%)`);
      }
    }

    // 9. Generate and Write beautiful Audit Logs File
    const importsDir = path.join(__dirname, '..', 'imports');
    if (!fs.existsSync(importsDir)) {
      fs.mkdirSync(importsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const auditFilePath = path.join(importsDir, `import_audit_${timestamp}.json`);
    fs.writeFileSync(auditFilePath, JSON.stringify(auditLogs, null, 2), 'utf-8');

    // 10. Display Exquisite ASCII Summary Report
    const totalSuccessful = auditLogs.successfulUpserts.length;
    const totalMissing = auditLogs.missingEmployees.length;
    const totalInvalid = auditLogs.invalidRows.length;
    const totalDuplicates = auditLogs.duplicateFileEntries.length;
    const totalDbFailures = auditLogs.failedDBWrites.length;

    console.log(`
┌────────────────────────────────────────────────────────┐
│             EXCEL ATTENDANCE IMPORT SUMMARY            │
├────────────────────────────────────────────────────────┤
│  Parsed Excel Rows     : ${String(rawData.length).padEnd(29)} │
│  Successful Upserts    : ${String(totalSuccessful).padEnd(29)} │
│  Missing Employees     : ${String(totalMissing).padEnd(29)} │
│  Invalid Excel Rows    : ${String(totalInvalid).padEnd(29)} │
│  File-Level Duplicates : ${String(totalDuplicates).padEnd(29)} │
│  Failed DB Writes      : ${String(totalDbFailures).padEnd(29)} │
├────────────────────────────────────────────────────────┤
│  Audit Logs Saved To   : ${String('/imports/' + path.basename(auditFilePath)).padEnd(29)} │
└────────────────────────────────────────────────────────┘
`);

    logger.info(`✅ Attendance import completed successfully!`);

  } catch (fatalErr) {
    logger.error(`❌ Critical Import Failure: ${fatalErr.message}`);
    logger.error(fatalErr.stack);
  } finally {
    await mongoose.disconnect();
    logger.info(`🔌 DB Connection closed cleanly. Exiting.`);
    process.exit(0);
  }
};

// Start Execution
importAttendance();
