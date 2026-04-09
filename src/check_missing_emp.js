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

const checkMissingEmployees = async () => {
    try {
        await connectDB();
        
        const filePath = path.join(__dirname, '..', 'attendance1.xlsx');
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet, { raw: true });
        
        console.log('Total Excel Rows:', data.length);
        
        const employees = await Employee.find({}, { employeeCode: 1 }).lean();
        const employeeSet = new Set(employees.map(e => e.employeeCode.toUpperCase()));
        
        console.log('Total Employees in DB:', employeeSet.size);
        
        let unknownCount = 0;
        const unknownCodes = new Set();
        
        data.forEach(row => {
            const code = String(row.Emp_Code).toUpperCase();
            if (!employeeSet.has(code)) {
                unknownCount++;
                unknownCodes.add(code);
            }
        });
        
        console.log('Rows with Unknown Employee Codes:', unknownCount);
        console.log('Unique Unknown Codes:', unknownCodes.size);
        if (unknownCodes.size > 0) {
            console.log('Sample Unknown Codes:', Array.from(unknownCodes).slice(0, 10));
        }
        
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

checkMissingEmployees();
