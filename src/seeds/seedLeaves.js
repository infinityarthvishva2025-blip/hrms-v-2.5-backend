import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Leave } from '../models/Leave.model.js';
import { Employee } from '../models/Employee.model.js';
import { connectDB } from '../config/db.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Convert Excel serial date or string to JavaScript Date
 */
const excelDateToJSDate = (serial) => {
    if (!serial || serial === 'NULL' || serial === '-') return null;
    if (typeof serial === 'string') {
        const d = new Date(serial);
        return isNaN(d.getTime()) ? null : d;
    }
    // Excel base date is Dec 30, 1899
    const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
    return isNaN(date.getTime()) ? null : date;
};

/**
 * Clean and trim string values
 */
const cleanStr = (val) => {
    if (val === undefined || val === null || val === 'NULL' || val === '-' || val === 'null') {
        return '';
    }
    return String(val).trim();
};

/**
 * Main seeding function
 */
const seedLeaves = async () => {
    try {
        await connectDB();
        logger.info('Connected to MongoDB. Starting leave seeding...');

        // Read Excel file
        const filePath = path.join(__dirname, '..', 'leaves-data.xlsx');
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(worksheet);

        // Cache all employees for quick lookup (EmployeeCode -> _id)
        const employees = await Employee.find({}, { employeeCode: 1 }).lean();
        const employeeMap = new Map();
        employees.forEach(emp => {
            if (emp.employeeCode) {
                employeeMap.set(emp.employeeCode.toUpperCase(), emp._id);
            }
        });

        let insertedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const row of rows) {
            try {
                const employeeCodeRaw = cleanStr(row.EmployeeCode);
                if (!employeeCodeRaw) {
                    logger.warn('Skipping row: Missing EmployeeCode');
                    skippedCount++;
                    continue;
                }

                const employeeCode = employeeCodeRaw.toUpperCase();
                const employeeId = employeeMap.get(employeeCode);

                if (!employeeId) {
                    logger.warn(`Skipping leave for ${employeeCode}: Employee not found in database`);
                    skippedCount++;
                    continue;
                }

                const startDate = excelDateToJSDate(row.StartDate);
                const endDate = excelDateToJSDate(row.EndDate);

                if (!startDate || !endDate) {
                    logger.warn(`Skipping leave for ${employeeCode}: Invalid dates`);
                    skippedCount++;
                    continue;
                }

                const totalDays = Number(row.TotalDays) || 0;
                const reason = cleanStr(row.Reason) || 'No reason provided';
                const overallStatus = cleanStr(row.OverallStatus) || 'Approved';

                // Build leave document
                const leaveData = {
                    employeeId,
                    leaveType: 'Casual',
                    startDate,
                    endDate,
                    totalDays,
                    reason,
                    managerStatus: 'Approved',
                    hrStatus: 'Approved',
                    gmStatus: 'Approved',
                    vpStatus: 'Approved',
                    directorStatus: 'Approved',
                    overallStatus,
                    halfDay: false,
                    halfDayPeriod: '',
                    currentApproverRole: 'Completed',
                };

                await Leave.create(leaveData);
                insertedCount++;
                logger.info(`Inserted leave for ${employeeCode} (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]})`);

            } catch (err) {
                logger.error(`Error inserting leave for row with EmployeeCode ${row.EmployeeCode}: ${err.message}`);
                errorCount++;
            }
        }

        logger.info(`Leave seeding completed. Inserted: ${insertedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);
        process.exit(0);

    } catch (error) {
        logger.error(`Seeding failed: ${error.message}`);
        process.exit(1);
    }
};

seedLeaves();