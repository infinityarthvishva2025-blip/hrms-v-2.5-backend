import 'dotenv/config';
import mongoose from 'mongoose';
import xlsx from 'xlsx';
import { Employee } from   '../src/models/Employee.model.js'   //'../models/Employee.models.js'; // ✅ FIXED PATH
import { logger } from  '../src/utils/logger.js'    //'../src/utils/logger.js';






///
// import 'dotenv/config';
// import mongoose from 'mongoose';
// import xlsx from 'xlsx';
// import { Employee } from '../models/Employee.models.js';
// import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────
// ✅ CONNECT DB
// ─────────────────────────────────────────────
// import 'dotenv/config';
// import mongoose from 'mongoose';
// import xlsx from 'xlsx';
// import { Employee } from '../models/Employee.models.js';
// import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────
// ✅ CONNECT DB
// ─────────────────────────────────────────────
const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  logger.info('✅ Connected to MongoDB');
};

// ─────────────────────────────────────────────
// ✅ DATE PARSER
// ─────────────────────────────────────────────
const parseDate = (value) => {
  if (!value) return null;

  if (typeof value === 'number') {
    return new Date((value - 25569) * 86400 * 1000);
  }

  const d = new Date(value);
  return isNaN(d) ? null : d;
};

// ─────────────────────────────────────────────
// ✅ GET NEXT EMPLOYEE CODE (AUTO FIX 🔥)
// ─────────────────────────────────────────────
const getNextEmployeeCode = async () => {
  const last = await Employee.findOne({}, { employeeCode: 1 })
    .sort({ employeeCode: -1 });

  if (!last) return 'IA00001';

  const num = parseInt(last.employeeCode.slice(2)) + 1;
  return `IA${String(num).padStart(5, '0')}`;
};

// ─────────────────────────────────────────────
// ✅ MAPPING FUNCTION
// ─────────────────────────────────────────────
const mapEmployee = async (row) => {
  let employeeCode = row.EmployeeCode?.trim();

  // ❗ If invalid or duplicate → auto-generate
  if (!employeeCode || !/^IA\d{5}$/.test(employeeCode)) {
    employeeCode = await getNextEmployeeCode();
  }

  const existsCode = await Employee.findOne({ employeeCode });
  if (existsCode) {
    employeeCode = await getNextEmployeeCode();
  }

  return {
    employeeCode,
    name: row.Name?.trim(),
    email: row.Email?.toLowerCase().trim(),
    password: row.Password || '123456',

    role: row.Role || 'Employee',
    status: row.Status || 'Active',

    mobileNumber: row.MobileNumber,

    dateOfBirth: parseDate(row.DOB_Date),
    joiningDate: parseDate(row.JoiningDate),

    department: row.Department,
    position: row.Position,
    salary: Number(row.Salary) || 0,

    fatherName: row.FatherName,
    motherName: row.MotherName,

    currentAddress: row.Address,
    permanentAddress: row.PermanentAddress,

    district: row.District,
    state: row.State,
    pincode: row.Pincode,

    experienceType: row.ExperienceType,
    totalExperienceYears: Number(row.TotalExperienceYears) || 0,

    aadhaarNumber: row.AadhaarNumber,
    panNumber: row.PanNumber,
  };
};

// ─────────────────────────────────────────────
// ✅ MAIN SEED FUNCTION
// ─────────────────────────────────────────────
const seedEmployees = async () => {
  try {
    await connectDB();

    const workbook = xlsx.readFile('./src/employees.xlsx');
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = xlsx.utils.sheet_to_json(sheet);

    logger.info(`📊 Total Records: ${rawData.length}`);

    const seenEmails = new Set();
    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rawData) {
      try {
        const email = row.Email?.toLowerCase().trim();

        // ❌ Invalid
        if (!email) {
          skipped++;
          continue;
        }

        // ❌ Duplicate in Excel
        if (seenEmails.has(email)) {
          skipped++;
          continue;
        }
        seenEmails.add(email);

        // ❌ Duplicate in DB
        const exists = await Employee.findOne({ email });
        if (exists) {
          skipped++;
          continue;
        }

        const data = await mapEmployee(row);

        const emp = new Employee(data);
        await emp.save(); // 🔥 hashing works

        success++;
        logger.info(`✅ ${success} Inserted: ${email}`);
      } catch (err) {
        failed++;

        if (err.code === 11000) {
          logger.warn(`⚠️ Duplicate skipped: ${row.Email}`);
        } else {
          logger.error(`❌ Failed (${row.Email}): ${err.message}`);
        }
      }
    }

    // ─────────────────────────────────────────
    // ✅ SAFE HR USER CREATION
    // ─────────────────────────────────────────
    const hrEmail = 'hr@infinity.com';

    let hrUser = await Employee.findOne({ email: hrEmail });

    if (hrUser) {
      hrUser.password = '123456';
      hrUser.role = 'HR';
      await hrUser.save();
      logger.info('🔁 HR updated');
    } else {
      const newCode = await getNextEmployeeCode();

      await Employee.create({
        employeeCode: newCode,
        name: 'Super HR',
        email: hrEmail,
        mobileNumber: '9999999999',
        password: '123456',
        role: 'HR',
        department: 'HR',
      });

      logger.info('🆕 HR created');
    }

    // ─────────────────────────────────────────
    // ✅ FINAL REPORT
    // ─────────────────────────────────────────
    logger.info('──────────── SUMMARY ────────────');
    logger.info(`✅ Success: ${success}`);
    logger.info(`⏭ Skipped: ${skipped}`);
    logger.info(`❌ Failed: ${failed}`);

    await mongoose.disconnect();
    logger.info('🔌 Disconnected');

    process.exit(0);
  } catch (err) {
    logger.error('❌ Fatal Error:', err);

    await mongoose.disconnect();
    process.exit(1);
  }
};

// 🚀 RUN
seedEmployees();