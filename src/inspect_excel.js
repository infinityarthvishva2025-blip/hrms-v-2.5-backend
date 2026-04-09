import xlsx from 'xlsx';
import path from 'path';

const files = ['employees.xlsx', 'attendance1.xlsx'];
const baseDir = 'C:\\Users\\kk\\Desktop\\Madhav More\\2026\\april\\HRMS\\hrms-v-2.3\\hrms-v-2.3\\backend\\src';

files.forEach(file => {
    const filePath = path.join(baseDir, file);
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);
    
    console.log(`--- File: ${file} ---`);
    if (data.length > 0) {
        console.log('Columns:', Object.keys(data[0]));
        console.log('First Row Sample:', JSON.stringify(data[0], null, 2));
    } else {
        console.log('No data found');
    }
    console.log('\n');
});
