import xlsx from 'xlsx';
import path from 'path';

const filePath = 'C:\\Users\\kk\\Desktop\\Madhav More\\2026\\april\\HRMS\\hrms-v-2.3\\hrms-v-2.3\\backend\\src\\attendance1.xlsx';
const workbook = xlsx.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json(worksheet);

console.log('Total Rows:', data.length);

const setWithNormalDate = new Set();
const setWithRawDate = new Set();
const setWithId = new Set();

data.forEach((row, i) => {
    const emp = row.Emp_Code || 'no_code';
    const date = row.Date;
    const id = row.Id;

    setWithNormalDate.add(`${emp}_${Math.floor(date)}`);
    setWithRawDate.add(`${emp}_${date}`);
    setWithId.add(`${id}`);
});

console.log('Unique (Emp_Code, Math.floor(Date)):', setWithNormalDate.size);
console.log('Unique (Emp_Code, Raw Date):', setWithRawDate.size);
console.log('Unique (Id):', setWithId.size);

if (setWithNormalDate.size < data.length) {
    const samples = [];
    const seen = new Map();
    for (const row of data) {
        const key = `${row.Emp_Code}_${Math.floor(row.Date)}`;
        if (seen.has(key)) {
            samples.push({ key, row1: seen.get(key), row2: row });
            if (samples.length >= 3) break;
        } else {
            seen.set(key, row);
        }
    }
    console.log('Sample Duplicates:', JSON.stringify(samples, null, 2));
}
process.exit(0);
