import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const generateSampleExcel = () => {
  const data = [
    { Emp_Code: 'IA00004', Date: '2026-05-05', Status: 'P', InTime: '09:47:55', OutTime: '18:19:00' },
    { Emp_Code: 'IA00005', Date: '2026-05-05', Status: 'P', InTime: '10:00:00', OutTime: '18:32:00' },
    { Emp_Code: 'IA00014', Date: '2026-05-05', Status: 'P', InTime: '09:53:53', OutTime: '18:41:00' },
    { Emp_Code: 'IA00019', Date: '2026-05-05', Status: 'P', InTime: '10:18:15', OutTime: '18:54:00' },
    { Emp_Code: 'IA00022', Date: '2026-05-05', Status: 'P', InTime: '10:06:04', OutTime: '18:44:00' }
  ];

  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet(data);
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Attendance');

  const outputPath = path.resolve(__dirname, '..', 'attendance_import.xlsx');
  xlsx.writeFile(workbook, outputPath);
  console.log(`✅ Sample Excel file created at: ${outputPath}`);
};

generateSampleExcel();
