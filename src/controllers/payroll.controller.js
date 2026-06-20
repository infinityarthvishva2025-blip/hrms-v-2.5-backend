import { Payroll } from '../models/Payroll.model.js';
import { Attendance } from '../models/Attendance.model.js';
import { Employee } from '../models/Employee.model.js';
import { Holiday } from '../models/Holiday.model.js';
import { Leave } from '../models/Leave.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { evaluateWorkingMinutes } from '../utils/attendanceHelper.js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const convertNumberToWords = (amount) => {
  const words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  if (amount === 0) return "Zero";
  let word = "";
  let tempAmount = Math.floor(amount);
  if (tempAmount >= 10000000) { word += convertNumberToWords(Math.floor(tempAmount / 10000000)) + " Crore "; tempAmount %= 10000000; }
  if (tempAmount >= 100000) { word += convertNumberToWords(Math.floor(tempAmount / 100000)) + " Lakh "; tempAmount %= 100000; }
  if (tempAmount >= 1000) { word += convertNumberToWords(Math.floor(tempAmount / 1000)) + " Thousand "; tempAmount %= 1000; }
  if (tempAmount >= 100) { word += convertNumberToWords(Math.floor(tempAmount / 100)) + " Hundred "; tempAmount %= 100; }
  if (tempAmount > 0) {
    if (word !== "") word += "and ";
    if (tempAmount < 20) word += words[tempAmount];
    else { word += tens[Math.floor(tempAmount / 10)] + " "; word += words[tempAmount % 10]; }
  }
  return word.trim();
};

/**
 * PT is always calculated on the employee's BASE SALARY (CTC), not grossEarnings.
 * Rules:
 *  - February (month index 1, 0-based): flat ₹300
 *  - Female: ₹200 if baseSalary > ₹25,000, else ₹0
 *  - Male / Other: ₹200 if baseSalary > ₹10,000, else ₹0
 *    (The ₹175 tier for 7,500–10,000 has been removed per updated policy)
 */
const calculatePT = (baseSalary, gender, month) => {
  const normalizedGender = gender?.toLowerCase();

  // =========================
  // FEMALE
  // =========================
  if (normalizedGender === 'female') {
    // Up to 25,000 => NIL
    if (baseSalary <= 25000) {
      return 0;
    }

    // February => 300
    if (month === 1) {
      return 300;
    }

    // Other months
    return 200;
  }

  // =========================
  // MALE / OTHER
  // =========================

  // Up to 7,500 => NIL
  if (baseSalary <= 7500) {
    return 0;
  }

  // 7,501 to 10,000 => 175
  if (baseSalary <= 10000) {
    return 175;
  }

  // Above 10,000
  if (month === 1) {
    return 300; // February
  }

  return 200;
};


// const calculatePT = (baseSalary, gender, month) => {
//   // February special rule (0-indexed: Jan=0, Feb=1)
//   if (month === 1) {
//     return 300;
//   }

//   if (gender === 'Female') {
//     return baseSalary > 25000 ? 200 : 0;
//   } else {
//     // Male or Other
//     return baseSalary > 10000 ? 200 : 0;
//   }
// };

// ─── GENERATE PAYROLL (HELPER FOR SINGLE EMPLOYEE) ──────────────────────────

export const processSingleEmployeePayroll = async ({ employeeId, fromDate, toDate, targetMonth, targetYear, processedBy }) => {
  const employee = await Employee.findById(employeeId);
  if (!employee) return null;

  // Total days in range is inclusive: count every calendar day from fromDate to toDate.
  // We add 1 because both endpoints are included (e.g. Mar 21 → Apr 20 = 31 days, not 30).
  // toDate is set to 23:59:59 on the last day, so we floor the difference then add 1.
  const totalDaysInRange = Math.floor((toDate - fromDate) / (1000 * 60 * 60 * 24)) + 1;

  // Calculate extended range for sandwich checking
  const extendedFromDate = new Date(fromDate);
  extendedFromDate.setUTCDate(extendedFromDate.getUTCDate() - 10);
  const extendedToDate = new Date(toDate);
  extendedToDate.setUTCDate(extendedToDate.getUTCDate() + 10);

  // ── FETCH ATTENDANCE, HOLIDAYS & APPROVED LEAVES (EXTENDED FOR SANDWICH CHECK) ──
  const [attendanceRecords, holidayRecords, approvedLeaves] = await Promise.all([
    Attendance.find({
      employeeId,
      date: { $gte: extendedFromDate, $lte: extendedToDate }
    }),
    Holiday.find({
      date: { $gte: extendedFromDate, $lte: extendedToDate }
    }),
    // Only fetch leaves that have been fully approved
    Leave.find({
      employeeId,
      overallStatus: 'Approved',
      startDate: { $lte: extendedToDate },
      endDate: { $gte: extendedFromDate }
    })
  ]);

  const summary = {
    present: 0,
    half: 0,
    absent: 0,
    holiday: 0,
    weekOff: 0
  };

  const halfDayDetails = [];
  const absentDayDetails = [];
  const presentDayDetails = [];

  const getUTCDateStr = (date) => {
    const d = new Date(date);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  };

  // Status cache for extended range
  const statusCache = {};

  const getDayStatus = (d) => {
    const dStr = getUTCDateStr(d);
    if (statusCache[dStr]) return statusCache[dStr];

    const isSunday = d.getUTCDay() === 0;
    const isHolid = holidayRecords.some(h => getUTCDateStr(h.date) === dStr);

    const record = attendanceRecords.find(r => getUTCDateStr(r.date) === dStr);
    
    // Check if employee worked on Sunday/Holiday
    if (record && (record.status === 'P' || record.status === 'Half' || record.status === 'Coff')) {
      if (record.status === 'Coff') {
        statusCache[dStr] = 'PRESENT';
        return 'PRESENT';
      }
      const workedMins = record.totalMinutes || Math.round((record.totalHours || 0) * 60);
      const evalResult = evaluateWorkingMinutes(d, workedMins);
      if (evalResult.isFullDay && record.status !== 'Half') {
        statusCache[dStr] = 'PRESENT';
        return 'PRESENT';
      } else if (evalResult.isHalfDay || record.status === 'Half') {
        statusCache[dStr] = 'HALF';
        return 'HALF';
      }
    }

    if (isSunday || isHolid) {
      statusCache[dStr] = 'WO_HOLIDAY';
      return 'WO_HOLIDAY';
    }

    if (record) {
      if (record.status === 'P' || record.status === 'Half' || record.status === 'Coff') {
        if (record.status === 'Coff') {
          statusCache[dStr] = 'PRESENT';
          return 'PRESENT';
        }
        const workedMins = record.totalMinutes || Math.round((record.totalHours || 0) * 60);
        const evalResult = evaluateWorkingMinutes(d, workedMins);
        if (evalResult.isFullDay && record.status !== 'Half') {
          statusCache[dStr] = 'PRESENT';
          return 'PRESENT';
        } else if (evalResult.isHalfDay || record.status === 'Half') {
          statusCache[dStr] = 'HALF';
          return 'HALF';
        } else {
          statusCache[dStr] = 'LEAVE_ABSENT';
          return 'LEAVE_ABSENT';
        }
      } else if (['Paid', 'Sick', 'Casual', 'Earned', 'CompOff', 'L'].includes(record.status)) {
        const hasApprovedLeave = approvedLeaves.some(leave => {
          const leaveStart = getUTCDateStr(leave.startDate);
          const leaveEnd = getUTCDateStr(leave.endDate);
          return dStr >= leaveStart && dStr <= leaveEnd;
        });

        if (hasApprovedLeave) {
          statusCache[dStr] = 'LEAVE_ABSENT';
          return 'LEAVE_ABSENT';
        } else {
          statusCache[dStr] = 'LEAVE_ABSENT';
          return 'LEAVE_ABSENT';
        }
      } else {
        statusCache[dStr] = 'LEAVE_ABSENT';
        return 'LEAVE_ABSENT';
      }
    } else {
      statusCache[dStr] = 'LEAVE_ABSENT';
      return 'LEAVE_ABSENT';
    }
  };

  // Pre-fill cache
  let tempDate = new Date(extendedFromDate);
  while (tempDate <= extendedToDate) {
    getDayStatus(tempDate);
    tempDate.setUTCDate(tempDate.getUTCDate() + 1);
  }

  const isSandwiched = (d) => {
    if (getDayStatus(d) !== 'WO_HOLIDAY') {
      return false;
    }

    // Search backwards
    let leftStatus = null;
    let tempLeft = new Date(d);
    while (true) {
      tempLeft.setUTCDate(tempLeft.getUTCDate() - 1);
      if (tempLeft < extendedFromDate) break;
      const status = getDayStatus(tempLeft);
      if (status !== 'WO_HOLIDAY') {
        leftStatus = status;
        break;
      }
    }

    // Search forwards
    let rightStatus = null;
    let tempRight = new Date(d);
    while (true) {
      tempRight.setUTCDate(tempRight.getUTCDate() + 1);
      if (tempRight > extendedToDate) break;
      const status = getDayStatus(tempRight);
      if (status !== 'WO_HOLIDAY') {
        rightStatus = status;
        break;
      }
    }

    return leftStatus === 'LEAVE_ABSENT' && rightStatus === 'LEAVE_ABSENT';
  };

  const sandwichDetails = [];

  let current = new Date(fromDate);
  while (current <= toDate) {
    const dStr = getUTCDateStr(current);
    const record = attendanceRecords.find(r => getUTCDateStr(r.date) === dStr);
    const isSunday = current.getUTCDay() === 0; // Use UTC day since fromDate/toDate are UTC
    const isHolid = holidayRecords.some(h => getUTCDateStr(h.date) === dStr);

    if (isSunday) {
      summary.weekOff++;
      if (isSandwiched(current)) {
        sandwichDetails.push({
          date: new Date(current),
          reason: 'Weekly Off (Sandwiched)'
        });
      }
    } else if (isHolid) {
      summary.holiday++;
      if (isSandwiched(current)) {
        sandwichDetails.push({
          date: new Date(current),
          reason: 'Holiday (Sandwiched)'
        });
      }
    } else if (record) {
      if (record.status === 'P' || record.status === 'Half' || record.status === 'Coff') {
        if (record.status === 'Coff') {
          summary.present++;
          presentDayDetails.push({
            date: new Date(current),
            reason: 'Compensatory Off (Coff)'
          });
        } else {
          const workedMins = record.totalMinutes || Math.round((record.totalHours || 0) * 60);
          const evalResult = evaluateWorkingMinutes(current, workedMins);

          if (evalResult.isFullDay && record.status !== 'Half') {
            summary.present++;
            presentDayDetails.push({
              date: new Date(current),
              reason: `Full Present: Worked ${(record.totalHours || workedMins / 60).toFixed(2)} hrs`
            });
          } else if (evalResult.isHalfDay || record.status === 'Half') {
            summary.half++;
            halfDayDetails.push({ 
              date: new Date(current), 
              reason: `Worked ${record.totalHours || (workedMins / 60).toFixed(2)} hrs (Required: ${evalResult.requiredFullMinutes} min, worked: ${workedMins} min)` 
            });
          } else {
            summary.absent++;
            absentDayDetails.push({ 
              date: new Date(current), 
              reason: `Worked ${record.totalHours || (workedMins / 60).toFixed(2)} hrs (Below half day threshold: ${evalResult.minHalfMinutes} min)` 
            });
          }
        }
      } else if (['Paid', 'Sick', 'Casual', 'Earned', 'CompOff', 'L'].includes(record.status)) {
        // All leave types (approved or not) count as absent — no salary credit for leaves.
        const currentDateStr = getUTCDateStr(current);
        const hasApprovedLeave = approvedLeaves.some(leave => {
          const leaveStart = getUTCDateStr(leave.startDate);
          const leaveEnd = getUTCDateStr(leave.endDate);
          return currentDateStr >= leaveStart && currentDateStr <= leaveEnd;
        });
        const leaveLabel = hasApprovedLeave
          ? `Leave (${record.status}) — Approved`
          : `Leave (${record.status}) — Unapproved / LWP`;
        summary.absent++;
        absentDayDetails.push({ date: new Date(current), reason: leaveLabel });
      } else {
        summary.absent++;
        absentDayDetails.push({ date: new Date(current), reason: `Status: ${record.status}` });
      }
    } else {
      summary.absent++;
      absentDayDetails.push({ date: new Date(current), reason: 'No Check-in' });
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  const sandwichDeductions = sandwichDetails.length;
  // paidDays: present + half-days + week-offs + holidays minus any sandwich deductions.
  // Leaves are NOT included — all leave types are treated as absent (LWP).
  const paidDays = summary.present + (summary.half * 0.5) + summary.weekOff + summary.holiday - sandwichDeductions;
  const baseSalary = employee.salary || 0;
  
  const divisor = totalDaysInRange >= 28 ? totalDaysInRange : 30;
  const dailyRate = baseSalary / divisor;
  const grossEarnings = parseFloat((dailyRate * paidDays).toFixed(2));

  const professionalTax = calculatePT(baseSalary, employee.gender, toDate.getUTCMonth());
  const netSalary = Math.max(0, grossEarnings - professionalTax);

  // leavesTaken = all absent days (includes all leave types) + half-day deductions + sandwich deductions
  const leavesTaken = summary.absent + (summary.half * 0.5) + sandwichDeductions;

  return await Payroll.findOneAndUpdate(
    { employeeId, month: targetMonth, year: targetYear },
    {
      employeeCode: employee.employeeCode,
      employeeName: employee.name,
      fromDate, toDate,
      totalDaysInMonth: totalDaysInRange,
      presentDays: summary.present,
      presentDayDetails,
      halfDays: summary.half,
      halfDayDetails,
      absentDays: summary.absent,
      absentDayDetails,
      paidLeaves: 0,           // deprecated — all leaves are now absent
      unpaidLeaves: summary.absent + sandwichDeductions,
      holidays: summary.holiday,
      weekOffs: summary.weekOff,
      sandwichDeductions,
      sandwichDetails,
      paidDays, baseSalary, grossEarnings, professionalTax, netSalary,
      leavesTaken,
      status: 'Processed',
      processedBy
    },
    { upsert: true, new: true }
  );
}

// ─── GENERATE PAYROLL ENDPOINT ───────────────────────────────────────────────

export const generatePayroll = asyncHandler(async (req, res) => {
  const { employeeId, month, year, startDate, endDate } = req.body;
  if (!employeeId) throw new ApiError(400, 'employeeId is required');

  const isManagement = ['SuperUser', 'HR', 'Director', 'VP', 'GM', 'Manager'].includes(req.user.role);
  if (!isManagement && req.user._id.toString() !== employeeId) {
    throw new ApiError(403, 'You are not authorized to generate payroll for other employees.');
  }

  let fromDate, toDate;
  let targetMonth, targetYear;

  if (startDate && endDate) {
    // Force UTC midnight to prevent timezone-related day shifts during generation
    fromDate = new Date(`${startDate}T00:00:00Z`);
    toDate = new Date(`${endDate}T23:59:59Z`);
    targetMonth = toDate.getUTCMonth() + 1;
    targetYear = toDate.getUTCFullYear();
  } else if (month && year) {
    // Default cycle (21st to 20th) logic in UTC
    fromDate = new Date(Date.UTC(year, month - 2, 21, 0, 0, 0));
    toDate = new Date(Date.UTC(year, month - 1, 20, 23, 59, 59));
    targetMonth = month;
    targetYear = year;
  } else {
    throw new ApiError(400, 'Either startDate/endDate or month/year is required');
  }

  const payroll = await processSingleEmployeePayroll({
    employeeId, fromDate, toDate, targetMonth, targetYear, processedBy: req.user._id
  });

  if (!payroll) throw new ApiError(404, 'Employee not found');
  res.status(200).json(new ApiResponse(200, payroll, 'Payroll generated successfully'));
});

// ─── GENERATE ALL PAYROLL (BULK) ─────────────────────────────────────────────

export const generateAllPayroll = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.body;
  if (!startDate || !endDate) throw new ApiError(400, 'startDate and endDate are required');

  const fromDate = new Date(`${startDate}T00:00:00Z`);
  const toDate = new Date(`${endDate}T23:59:59Z`);
  const targetMonth = toDate.getUTCMonth() + 1;
  const targetYear = toDate.getUTCFullYear();

  // Fetch ALL active employees
  const employees = await Employee.find({ status: 'Active' });
  
  const results = [];
  // Use Promise.all with batching if employees > 100 to avoid overwhelming DB? 
  // For ~50 employees, a simple loop or Promise.all is fine.
  for (const emp of employees) {
    try {
      const payroll = await processSingleEmployeePayroll({
        employeeId: emp._id, fromDate, toDate, targetMonth, targetYear, processedBy: req.user._id
      });
      if (payroll) results.push(payroll);
    } catch (err) {
      console.error(`Failed for ${emp.name}:`, err);
    }
  }

  res.status(200).json(new ApiResponse(200, { count: results.length }, `Successfully processed payroll for ${results.length} employees`));
});


// ─── GET PAYROLL LIST ────────────────────────────────────────────────────────

export const getPayrollList = asyncHandler(async (req, res) => {
  const { month, year, status, startDate, endDate, employeeId, self, page = 1, limit = 1000 } = req.query;
  const isManagement = ['SuperUser', 'HR', 'Director', 'VP', 'GM', 'Manager'].includes(req.user.role);
  
  let query = {};

  // ── ROLE PROTECTION & SELF-QUERY ──
  if (self === 'true') {
    // Personal Portal View (Always restricted to own records)
    query.employeeId = req.user._id;
  } else if (!isManagement) {
    // Non-management role (Always restricted to own records)
    query.employeeId = req.user._id;
  } else if (employeeId) {
    // Management viewing a specific employee
    query.employeeId = employeeId;
  }
  // Otherwise: Manager viewing all (e.g. Admin Dashboard list)

  if (startDate && endDate) {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T23:59:59Z`);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      query.fromDate = { $lte: end };
      query.toDate = { $gte: start };
    }
  } else if (month && year) {
    query.month = Number(month);
    query.year = Number(year);
  }
  
  if (status) query.status = status;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.max(1, parseInt(limit));
  const skip = (pageNum - 1) * limitNum;

  const [payrolls, total] = await Promise.all([
    Payroll.find(query)
      .populate('employeeId', 'name employeeCode department position joiningDate panNumber bankName accountNumber ifsc branch')
      .sort({ employeeCode: 1 })
      .skip(skip)
      .limit(limitNum),
    Payroll.countDocuments(query)
  ]);

  const totalPages = Math.ceil(total / limitNum);

  res.status(200).json(new ApiResponse(200, {
    payrolls,
    pagination: { total, page: pageNum, limit: limitNum, totalPages }
  }, 'Payrolls fetched successfully'));
});

// ─── GENERATE SALARY SLIP PDF ────────────────────────────────────────────────

export const getSalarySlip = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const payroll = await Payroll.findById(id).populate('employeeId', 'joiningDate name employeeCode department position panNumber bankName accountNumber ifsc');
  
  if (!payroll) throw new ApiError(404, 'Payroll record not found');

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  
  // Format dates strictly using UTC to match the stored data regardless of server timezone
  const formatUTC = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(d));
  
  const fromStr = formatUTC(payroll.fromDate);
  const toStr = formatUTC(payroll.toDate);
  const targetMonthName = months[payroll.month - 1]; // Use the record's target month field
  const targetYear = payroll.year;
  
  const titleText = `${fromStr} - ${toStr} : PAYSLIP FOR THE MONTH OF ${targetMonthName.toUpperCase()} ${targetYear}`;
  const filename = `SalarySlip_${payroll.employeeCode}_${payroll.month}_${payroll.year}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

  doc.pipe(res);

  // --- BRANDING & HEADER ---
  const logoPathFront = path.join(__dirname, '../../frontend/src/assets/infinity logo.png');
  const logoPathBack = path.join(__dirname, '../assets/infinity logo.png');
  let logoToUse = null;
  if (fs.existsSync(logoPathFront)) logoToUse = logoPathFront;
  else if (fs.existsSync(logoPathBack)) logoToUse = logoPathBack;

  if (logoToUse) {
    // Center logo horizontally (A4 width is approx 595. 595/2 - 70 = 227.5)
    doc.image(logoToUse, 227.5, 30, { width: 140 });
  }

  // Move cursor sufficiently below the centered logo
  doc.y = 110;
  
  // --- SALARY SLIP TITLE ---
  doc.rect(40, doc.y, 515, 25).fill('#f2f2f2');
  doc.fillColor('#333333').fontSize(11).font('Helvetica-Bold')
     .text(titleText.toUpperCase(), 40, doc.y + 7, { align: 'center' });
  doc.fillColor('black');
  
  doc.moveDown(2);

  // --- EMPLOYEE SUMMARY SECTION ---
  const startY = doc.y;
  doc.font('Helvetica');
  const col1 = 45; const col2 = 150; const col3 = 300; const col4 = 400;

  const formatDate = (dateString) => dateString ? new Date(dateString).toLocaleDateString('en-GB') : 'N/A';
  
  doc.fontSize(9).font('Helvetica-Bold').text('Employee Name:', col1, startY);
  doc.font('Helvetica').text(`${payroll.employeeName || 'N/A'}`, col2, startY);
  
  doc.font('Helvetica-Bold').text('Employee ID:', col3, startY);
  doc.font('Helvetica').text(`${payroll.employeeCode || 'N/A'}`, col4, startY);

  doc.font('Helvetica-Bold').text('Designation:', col1, startY + 20);
  doc.font('Helvetica').text(`${payroll.employeeId?.position || 'N/A'}`, col2, startY + 20);

  doc.font('Helvetica-Bold').text('Department:', col3, startY + 20);
  doc.font('Helvetica').text(`${payroll.employeeId?.department || 'N/A'}`, col4, startY + 20);
  
  doc.font('Helvetica-Bold').text('Joining Date:', col1, startY + 40);
  doc.font('Helvetica').text(`${formatDate(payroll.employeeId?.joiningDate)}`, col2, startY + 40);

  doc.font('Helvetica-Bold').text('PAN:', col3, startY + 40);
  doc.font('Helvetica').text(`${payroll.employeeId?.panNumber || 'N/A'}`, col4, startY + 40);

  doc.font('Helvetica-Bold').text('Bank Name:', col1, startY + 60);
  doc.font('Helvetica').text(`${payroll.employeeId?.bankName || 'N/A'}`, col2, startY + 60);

  doc.font('Helvetica-Bold').text('Account No:', col3, startY + 60);
  doc.font('Helvetica').text(`${payroll.employeeId?.accountNumber || 'N/A'}`, col4, startY + 60);

  doc.moveDown(2);

  // --- ATTENDANCE BOX ---
  let attY = doc.y + 10;
  doc.rect(40, attY, 515, 45).lineWidth(0.5).stroke('#cccccc');
  
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#555555');
  doc.text('Total Days', 50, attY + 8);
  doc.text('Paid Days', 130, attY + 8);
  doc.text('Present', 210, attY + 8);
  doc.text('Half Days', 290, attY + 8);
  doc.text('Leaves/Hols', 370, attY + 8);
  doc.text('Absent/LWP', 450, attY + 8);

  doc.fontSize(10).font('Helvetica').fillColor('black');
  doc.text(`${payroll.totalDaysInMonth || 0}`, 50, attY + 25);
  doc.text(`${payroll.paidDays || 0}`, 130, attY + 25);
  doc.text(`${payroll.presentDays || 0}`, 210, attY + 25);
  doc.text(`${payroll.halfDays || 0}`, 290, attY + 25);
  doc.text(`${(payroll.paidLeaves || 0) + (payroll.holidays || 0) + (payroll.weekOffs || 0) - (payroll.sandwichDeductions || 0)}`, 370, attY + 25);
  doc.text(`${payroll.unpaidLeaves || 0}`, 450, attY + 25);

  doc.moveDown(3);

  // --- EARNINGS & DEDUCTIONS TABLE ---
  let tableY = doc.y + 10;

  // Table Headers
  doc.rect(40, tableY, 515, 20).fillAndStroke('#e9ecef', '#cccccc');
  doc.fillColor('black').font('Helvetica-Bold').fontSize(9);
  doc.text('EARNINGS', 50, tableY + 6);
  doc.text('AMOUNT (INR)', 220, tableY + 6, { width: 70, align: 'right' });
  doc.text('DEDUCTIONS', 310, tableY + 6);
  doc.text('AMOUNT (INR)', 470, tableY + 6, { width: 70, align: 'right' });

  // Draw central dividing line & outer borders
  doc.rect(40, tableY, 515, 140).stroke('#cccccc'); // Outer box
  doc.moveTo(298, tableY).lineTo(298, tableY + 140).stroke('#cccccc'); // Mid vertical
  doc.moveTo(205, tableY).lineTo(205, tableY + 140).stroke('#cccccc'); // Ear inner
  doc.moveTo(465, tableY).lineTo(465, tableY + 140).stroke('#cccccc'); // Ded inner

  let rowY = tableY + 25;
  doc.font('Helvetica').fontSize(9);

  // Earnings Rows
  let currentGross = parseFloat(payroll.grossEarnings || 0);

  doc.text('Basic Salary', 50, rowY);
  doc.text(`${currentGross.toFixed(2)}`, 220, rowY, { width: 70, align: 'right' });

  // Deductions Rows
  let pt = parseFloat(payroll.professionalTax || 0);
  let otherDed = parseFloat(payroll.otherDeductions || 0);

  doc.text('Professional Tax', 310, rowY);
  doc.text(`${pt.toFixed(2)}`, 470, rowY, { width: 70, align: 'right' });

  if (otherDed > 0) {
    doc.text('Other Deductions', 310, rowY + 18);
    doc.text(`${otherDed.toFixed(2)}`, 470, rowY + 18, { width: 70, align: 'right' });
  }

  // Draw Total separator
  doc.moveTo(40, tableY + 120).lineTo(555, tableY + 120).stroke('#cccccc');
  
  // Totals Line
  doc.font('Helvetica-Bold');
  let totEY = tableY + 125;
  doc.text('Total Earnings', 50, totEY);
  doc.text(`${currentGross.toFixed(2)}`, 220, totEY, { width: 70, align: 'right' });
  
  let totDed = pt + otherDed;
  doc.text('Total Deductions', 310, totEY);
  doc.text(`${totDed.toFixed(2)}`, 470, totEY, { width: 70, align: 'right' });

  // NET SALARY HIGHLIGHT
  let netY = tableY + 160;
  doc.rect(40, netY, 515, 30).fillAndStroke('#eef9f2', '#b2d9c0');
  doc.fillColor('#1f7035').fontSize(11);
  doc.text('Net Amount Payable:', 50, netY + 10);
  doc.fontSize(12).text(`INR ${parseFloat(payroll.netSalary || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 400, netY + 9, { width: 140, align: 'right' });
  
  // NET SALARY IN WORDS
  doc.fillColor('black').font('Helvetica').fontSize(9);
  doc.text(`Amount In Words: Rupees ${convertNumberToWords(Math.round(payroll.netSalary || 0))} Only`, 40, netY + 40);

  if (payroll.sandwichDeductions > 0) {
    doc.fillColor('#ef4444').font('Helvetica-Bold').fontSize(8);
    doc.text(`Note: ${payroll.sandwichDeductions} day(s) of Sandwich Leave Deduction applied.`, 40, netY + 55);
    doc.fillColor('black');
  }

  // --- FOOTER & SIGNATURE ---
  let footY = doc.y + 60;
  
  // Disclaimer
  doc.rect(40, footY, 515, 0).stroke('#cccccc');
  doc.font('Helvetica').fontSize(8).fillColor('gray');
  doc.text('This is a computer generated document and does not require a physical signature.', 40, footY + 10, { align: 'center' });

  doc.end();
});