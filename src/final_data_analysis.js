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

// Same parsing logic as seed
const parseAnyDate = (val) => {
    if (!val || val === 'NULL' || val === '-' || val === 'null' || val === '0') return null;
    if (typeof val === 'number') {
        const date = new Date(Math.round((val - 25569) * 86400 * 1000));
        return isNaN(date.getTime()) ? null : date;
    }
    if (typeof val === 'string') {
        let cleanVal = val.trim();
        if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}/.test(cleanVal)) {
            const parts = cleanVal.split(/[-\/]/);
            const d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
            return isNaN(d.getTime()) ? null : d;
        }
        const d = new Date(cleanVal);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
};

const finalAnalysis = async () => {
    try {
        await connectDB();
        const filePath = path.join(__dirname, '..', 'attendance1.xlsx');
        const workbook = xlsx.readFile(filePath);
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { raw: true });
        
        const employees = await Employee.find({}, { _id: 1, employeeCode: 1 }).lean();
        const employeeMap = new Map(employees.map(e => [e.employeeCode.toUpperCase(), e._id]));
        
        let validRows = 0;
        let unknownEmp = 0;
        let nullDate = 0;
        
        data.forEach(row => {
            const code = String(row.Emp_Code || '').trim().toUpperCase();
            const date = parseAnyDate(row.Date);
            
            if (!code || !date) {
                nullDate++;
                return;
            }
            
            if (!employeeMap.has(code)) {
                unknownEmp++;
                return;
            }
            
            validRows++;
        });
        
        console.log('Total Excel Rows:', data.length);
        console.log('Valid Records Ready to Insert:', validRows);
        console.log('Skipped (Missing Employee in DB):', unknownEmp);
        console.log('Skipped (Date Parsing Failed):', nullDate);
        
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

finalAnalysis();
