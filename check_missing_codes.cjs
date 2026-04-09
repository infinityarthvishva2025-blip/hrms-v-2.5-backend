const xlsx = require('xlsx');
const mongoose = require('mongoose');
const { connectDB } = require('./src/config/db.js');
const { Employee } = require('./src/models/Employee.model.js');
const path = require('path');

const check = async () => {
    try {
        await connectDB();
        const employees = await Employee.find({}, { employeeCode: 1 }).lean();
        const employeeCodes = new Set(employees.map(e => e.employeeCode.toUpperCase()));
        console.log('Total Employees in DB:', employeeCodes.size);
        
        const filePath = 'C:\\Users\\kk\\Desktop\\Madhav More\\2026\\april\\HRMS\\hrms-v-2.3\\hrms-v-2.3\\backend\\src\\attendance1.xlsx';
        const workbook = xlsx.readFile(filePath);
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { raw: true });
        
        let found = 0;
        let missing = 0;
        const missingCodes = new Set();
        
        data.forEach(row => {
            const code = String(row.Emp_Code || '').trim().toUpperCase();
            if (employeeCodes.has(code)) {
                found++;
            } else {
                missing++;
                missingCodes.add(code);
            }
        });
        
        console.log('Total Attendance Rows:', data.length);
        console.log('Rows with Matching EmployeeCode in DB:', found);
        console.log('Rows with MISSING EmployeeCode in DB:', missing);
        console.log('Unique Missing EmployeeCodes:', missingCodes.size);
        if (missingCodes.size > 0) {
            console.log('Sample Missing Codes:', Array.from(missingCodes).slice(0, 10));
        }
        
        process.exit(0);
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

check();
