import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wb = xlsx.readFile(path.join(__dirname, 'src', 'employees.xlsx'));
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);
const statuses = data.reduce((acc, row) => {
    acc[row.Status] = (acc[row.Status] || 0) + 1;
    return acc;
}, {});
console.log(JSON.stringify(statuses));
process.exit(0);
