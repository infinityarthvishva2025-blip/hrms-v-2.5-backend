import { Payroll } from '../models/Payroll.model.js';
import { Attendance } from '../models/Attendance.model.js';
import { Employee } from '../models/Employee.model.js';
import { Holiday } from '../models/Holiday.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const calculatePT = (salary, gender, month) => {
  // February special rule
  if (month === 1) { // 0-indexed Feb is 1
    return 300;
  }

  if (gender === 'Female') {
    return salary > 25000 ? 200 : 0;
  } else {
    // Male
    if (salary <= 7500) return 0;
    if (salary <= 10000) return 175;
    return 200;
  }
};

// ─── GENERATE PAYROLL (HELPER FOR SINGLE EMPLOYEE) ──────────────────────────

const processSingleEmployeePayroll = async ({ employeeId, fromDate, toDate, targetMonth, targetYear, processedBy }) => {
  const employee = await Employee.findById(employeeId);
  if (!employee) return null;

  // Fix: Total days in range should be inclusive (+1)
  const totalDaysInRange = Math.round((toDate - fromDate) / (1000 * 60 * 60 * 24));

  // ── FETCH ATTENDANCE & HOLIDAYS ──
  const [attendanceRecords, holidayRecords] = await Promise.all([
    Attendance.find({
      employeeId,
      date: { $gte: fromDate, $lte: toDate }
    }),
    Holiday.find({
      date: { $gte: fromDate, $lte: toDate }
    })
  ]);

  const summary = {
    present: 0,
    half: 0,
    absent: 0,
    paidLeave: 0,
    holiday: 0,
    weekOff: 0
  };

  const halfDayDetails = [];
  const absentDayDetails = [];

  let current = new Date(fromDate);
  while (current <= toDate) {
    const dStr = current.toDateString();
    const record = attendanceRecords.find(r => r.date.toDateString() === dStr);
    const isSunday = current.getDay() === 0;
    const isHolid = holidayRecords.some(h => h.date.toDateString() === dStr);

    if (isSunday) {
      summary.weekOff++;
    } else if (isHolid) {
      summary.holiday++;
    } else if (record) {
      if (record.status === 'P') {
        if (record.totalHours < 4) {
          summary.half++;
          halfDayDetails.push({ date: new Date(current), reason: `Worked ${record.totalHours} hrs` });
        } else {
          summary.present++;
        }
      } else if (['Paid', 'Sick', 'Casual', 'Earned', 'CompOff', 'L'].includes(record.status)) {
        summary.paidLeave++;
      } else {
        summary.absent++;
        absentDayDetails.push({ date: new Date(current), reason: `Status: ${record.status}` });
      }
    } else {
      summary.absent++;
      absentDayDetails.push({ date: new Date(current), reason: 'No Check-in' });
    }
    current = new Date(current.getTime() + 86400000);
  }

  const paidDays = summary.present + (summary.half * 0.5) + summary.paidLeave + summary.weekOff + summary.holiday;
  const baseSalary = employee.salary || 0;
  
  // Use the actual days in the range as the divisor if it represents a full month cycle (>= 28 days)
  // Otherwise, use 30 as a standard divisor for partial month calculations.
  const divisor = totalDaysInRange >= 28 ? totalDaysInRange : 30;
  const dailyRate = baseSalary / divisor;
  const grossEarnings = parseFloat((dailyRate * paidDays).toFixed(2));
  const professionalTax = calculatePT(grossEarnings, employee.gender, toDate.getMonth());
  const netSalary = Math.max(0, grossEarnings - professionalTax);

  return await Payroll.findOneAndUpdate(
    { employeeId, month: targetMonth, year: targetYear },
    {
      employeeCode: employee.employeeCode,
      employeeName: employee.name,
      fromDate, toDate,
      totalDaysInMonth: totalDaysInRange,
      presentDays: summary.present,
      halfDays: summary.half,
      halfDayDetails,
      absentDays: summary.absent,
      absentDayDetails,
      paidLeaves: summary.paidLeave,
      holidays: summary.holiday,
      weekOffs: summary.weekOff,
      paidDays, baseSalary, grossEarnings, professionalTax, netSalary,
      status: 'Processed',
      processedBy
    },
    { upsert: true, new: true }
  );
};

// ─── GENERATE PAYROLL ENDPOINT ───────────────────────────────────────────────

export const generatePayroll = asyncHandler(async (req, res) => {
  const { employeeId, month, year, startDate, endDate } = req.body;
  if (!employeeId) throw new ApiError(400, 'employeeId is required');

  let fromDate, toDate;
  let targetMonth, targetYear;

  if (startDate && endDate) {
    fromDate = new Date(startDate);
    fromDate.setHours(0, 0, 0, 0);
    toDate = new Date(endDate);
    toDate.setHours(23, 59, 59, 999);
    targetMonth = toDate.getMonth() + 1;
    targetYear = toDate.getFullYear();
  } else if (month && year) {
    fromDate = new Date(year, month - 2, 21);
    fromDate.setHours(0, 0, 0, 0);
    toDate = new Date(year, month - 1, 20);
    toDate.setHours(23, 59, 59, 999);
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

  const fromDate = new Date(startDate);
  fromDate.setHours(0, 0, 0, 0);
  const toDate = new Date(endDate);
  toDate.setHours(23, 59, 59, 999);
  const targetMonth = toDate.getMonth() + 1;
  const targetYear = toDate.getFullYear();

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
  const { month, year, status, startDate, endDate, employeeId, self } = req.query;
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
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      query.fromDate = { $lte: end.setHours(23,59,59,999) };
      query.toDate = { $gte: start.setHours(0,0,0,0) };
    }
  } else if (month && year) {
    query.month = Number(month);
    query.year = Number(year);
  }
  
  if (status) query.status = status;

  // INCREASE LIMIT to 1000 for management to ensure all 48+ employees are visible
  const payrolls = await Payroll.find(query)
    .populate('employeeId', 'name employeeCode department position')
    .sort({ createdAt: -1 })
    .limit(1000);

  res.status(200).json(new ApiResponse(200, payrolls, 'Payrolls fetched successfully'));
});

// ─── GENERATE SALARY SLIP PDF ────────────────────────────────────────────────

export const getSalarySlip = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const payroll = await Payroll.findById(id).populate('employeeId', 'name employeeCode department position panNumber bankName accountNumber ifsc');
  
  if (!payroll) throw new ApiError(404, 'Payroll record not found');

  const doc = new PDFDocument({ margin: 50 });
  const filename = `SalarySlip_${payroll.employeeCode}_${payroll.month}_${payroll.year}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

  doc.pipe(res);

  // ── HEADER ──
  doc.fontSize(20).text('INFINITY ARHHVISAVA', { align: 'center' });
  doc.fontSize(10).text('Building Modern HRMS Solutions', { align: 'center' });
  doc.moveDown();
  doc.fontSize(14).text('SALARY SLIP', { align: 'center', underline: true });
  doc.moveDown();

  // ── EMPLOYEE INFO ──
  const startX = 50;
  let currentY = doc.y;

  const formatDateRange = (from, to) => {
    const f = new Date(from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    const t = new Date(to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${f} to ${t}`;
  };

  doc.fontSize(10).text(`Employee Name: ${payroll.employeeName}`, startX, currentY);
  doc.text(`Employee Code: ${payroll.employeeCode}`, 350, currentY);
  currentY += 20;
  doc.text(`Designation: ${payroll.employeeId?.position || 'N/A'}`, startX, currentY);
  doc.text(`Department: ${payroll.employeeId?.department || 'N/A'}`, 350, currentY);
  currentY += 20;
  doc.text(`Period: ${formatDateRange(payroll.fromDate, payroll.toDate)}`, startX, currentY);
  doc.text(`PAN: ${payroll.employeeId?.panNumber || 'N/A'}`, 350, currentY);
  doc.moveDown(2);

  // ── ATTENDANCE TABLE ──
  currentY = doc.y;
  doc.fontSize(11).text('Attendance Summary', startX, currentY, { underline: true });
  currentY += 20;
  doc.fontSize(9);
  doc.text('Total Days', startX, currentY);
  doc.text('Present', startX + 100, currentY);
  doc.text('Half Days', startX + 200, currentY);
  doc.text('Paid Leaves', startX + 300, currentY);
  doc.text('Paid Days', startX + 400, currentY);
  currentY += 15;
  doc.text(`${payroll.totalDaysInMonth}`, startX, currentY);
  doc.text(`${payroll.presentDays}`, startX + 100, currentY);
  doc.text(`${payroll.halfDays}`, startX + 200, currentY);
  doc.text(`${payroll.paidLeaves}`, startX + 300, currentY);
  doc.text(`${payroll.paidDays}`, startX + 400, currentY);
  doc.moveDown(3);

  // ── SALARY DETAILS ──
  currentY = doc.y;
  doc.fontSize(11).text('Earnings & Deductions', startX, currentY, { underline: true });
  currentY += 20;
  
  // Table Borders
  doc.rect(startX, currentY, 500, 100).stroke();
  doc.moveTo(startX + 250, currentY).lineTo(startX + 250, currentY + 100).stroke();
  
  doc.fontSize(10);
  doc.text('Earnings', startX + 10, currentY + 10);
  doc.text('Amount', startX + 180, currentY + 10);
  doc.text('Deductions', startX + 260, currentY + 10);
  doc.text('Amount', startX + 430, currentY + 10);
  
  doc.moveTo(startX, currentY + 25).lineTo(startX + 500, currentY + 25).stroke();
  
  doc.text('Basic Salary', startX + 10, currentY + 35);
  doc.text(`${payroll.baseSalary.toLocaleString()}`, startX + 180, currentY + 35);
  
  doc.text('Professional Tax (PT)', startX + 260, currentY + 35);
  doc.text(`${payroll.professionalTax.toLocaleString()}`, startX + 430, currentY + 35);
  
  doc.text('Gross Earnings', startX + 10, currentY + 55);
  doc.text(`${payroll.grossEarnings.toLocaleString()}`, startX + 180, currentY + 55);

  doc.moveTo(startX, currentY + 75).lineTo(startX + 500, currentY + 75).stroke();
  
  doc.fontSize(11).font('Helvetica-Bold');
  doc.text('Net Salary', startX + 10, currentY + 85);
  doc.text(`INR ${payroll.netSalary.toLocaleString()}`, startX + 180, currentY + 85);
  doc.font('Helvetica');

  doc.moveDown(6);

  // ── BANK INFO ──
  doc.fontSize(10).text('Bank Details:', startX);
  doc.text(`Bank: ${payroll.employeeId?.bankName || 'N/A'}`);
  doc.text(`A/C No: ${payroll.employeeId?.accountNumber || 'N/A'}`);
  doc.text(`IFSC: ${payroll.employeeId?.ifsc || 'N/A'}`);

  doc.moveDown(4);
  doc.text('_______________________', startX);
  doc.text('Authorized Signatory', startX);
  doc.text('_______________________', 350);
  doc.text('Employee Signature', 350);

  doc.end();
});