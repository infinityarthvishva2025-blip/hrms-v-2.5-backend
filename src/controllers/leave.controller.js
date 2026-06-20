import { Leave } from '../models/Leave.model.js';
import { Employee } from '../models/Employee.model.js';
import { processMonthlyLeaveAccrual } from '../cron/leave.cron.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { Attendance } from '../models/Attendance.model.js';
import { Payroll } from '../models/Payroll.model.js';
import { processSingleEmployeePayroll } from './payroll.controller.js';

// ── ROLE CONSTANTS ──
const APPROVER_ROLES = ['SuperUser', 'HR', 'GM', 'VP', 'Director', 'Manager'];
const ADMIN_ROLES = ['SuperUser', 'HR', 'Director'];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function buildInitialApprovalState(applicantRole) {
  const base = {
    managerStatus: '-',
    hrStatus: 'Pending',
    gmStatus: '-',
    vpStatus: '-',
    directorStatus: '-',
    overallStatus: 'Pending',
    currentApproverRole: 'HR',
  };

  switch (applicantRole) {
    case 'Director':
    case 'SuperUser':
      return {
        ...base,
        hrStatus: '-',
        overallStatus: 'Approved',
        currentApproverRole: 'Completed',
      };
    default:
      return base;
  }
}

import { Holiday } from '../models/Holiday.model.js';
import mongoose from 'mongoose';

/**
 * Calculate total days between two dates, excluding Sundays and Holidays.
 */
async function calcActualLeaveDays(start, end, halfDay) {
  if (halfDay) return 0.5;
  
  let count = 0;
  let current = new Date(start);
  current.setHours(0, 0, 0, 0);
  const finish = new Date(end);
  finish.setHours(0, 0, 0, 0);

  // Fetch all holidays in range at once
  const holidays = await Holiday.find({
    date: { $gte: current, $lte: finish }
  });
  const holidayDates = new Set(holidays.map(h => h.date.toDateString()));

  while (current <= finish) {
    const dayOfWeek = current.getDay();
    const isSunday = dayOfWeek === 0;
    const isHoliday = holidayDates.has(current.toDateString());

    if (!isSunday && !isHoliday) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
}

function getNextApproverRole(currentRole, leave) {
  return 'Completed';
}

/**
 * Synchronize an approved leave request with the Attendance and Payroll modules.
 * Creates or updates Attendance records for all days covered by the leave,
 * and triggers recalculation/generation of any overlapping Payroll records.
 */
async function syncApprovedLeaveToAttendanceAndPayroll(leave, session = null) {
  try {
    const empId = leave.employeeId._id || leave.employeeId;
    const employee = await Employee.findById(empId);
    if (!employee) {
      console.error(`syncApprovedLeaveToAttendanceAndPayroll: Employee not found for ID: ${empId}`);
      return;
    }

    let current = new Date(leave.startDate);
    const end = new Date(leave.endDate);

    const startOfUTCDate = (date) => {
      const d = new Date(date);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
    };

    while (current <= end) {
      const targetDate = startOfUTCDate(current);

      // Find if there is an existing attendance record for the employee on this date
      const existing = await Attendance.findOne({
        employeeCode: employee.employeeCode,
        date: targetDate
      }).session(session);

      const status = leave.leaveType === 'CompOff' ? 'Coff' : 'L';

      if (existing) {
        existing.status = status;
        existing.inTime = undefined;
        existing.outTime = undefined;
        existing.totalHours = 0;
        existing.totalMinutes = 0;
        await existing.save({ session });
      } else {
        await Attendance.create([{
          employeeId: employee._id,
          employeeCode: employee.employeeCode,
          employeeName: employee.name,
          date: targetDate,
          status: status,
          totalHours: 0,
          totalMinutes: 0
        }], { session });
      }

      current.setUTCDate(current.getUTCDate() + 1);
    }

    // Now, fetch all existing payroll records for this employee that overlap the leave period
    const overlappingPayrolls = await Payroll.find({
      employeeId: employee._id,
      fromDate: { $lte: leave.endDate },
      toDate: { $gte: leave.startDate }
    }).session(session);

    for (const pr of overlappingPayrolls) {
      await processSingleEmployeePayroll({
        employeeId: pr.employeeId,
        fromDate: pr.fromDate,
        toDate: pr.toDate,
        targetMonth: pr.month,
        targetYear: pr.year,
        processedBy: empId
      });
    }
  } catch (err) {
    console.error('Error in syncApprovedLeaveToAttendanceAndPayroll:', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// APPLY FOR LEAVE
// ─────────────────────────────────────────────────────────────────────────────
export const applyLeave = asyncHandler(async (req, res) => {
  const { leaveType, startDate, endDate, reason, halfDay = false, halfDayPeriod = '' } = req.body;

  if (!leaveType || !startDate || !reason) {
    throw new ApiError(400, 'leaveType, startDate, and reason are required');
  }

  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : start;

  if (end < start) throw new ApiError(400, 'endDate cannot be before startDate');

  const totalDays = await calcActualLeaveDays(start, end, halfDay);
  if (totalDays === 0) throw new ApiError(400, 'Selected date range consists only of Sundays or Holidays');

  // ── BALANCE VALIDATION & DEDUCTION ──
  const employee = await Employee.findById(req.user._id);
  if (leaveType === 'Paid') {
    if ((employee.paidLeaveBalance || 0) < totalDays) {
      throw new ApiError(400, `Insufficient Paid Leave balance. Available: ${employee.paidLeaveBalance || 0}`);
    }
  } else if (leaveType === 'CompOff') {
    if ((employee.compOffBalance || 0) < totalDays) {
      throw new ApiError(400, `Insufficient Comp-Off balance. Available: ${employee.compOffBalance || 0}`);
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const approvalState = buildInitialApprovalState(req.user.role);

    // 1. Create Leave Record
    const leave = await Leave.create([{
      employeeId: req.user._id,
      leaveType,
      startDate: start,
      endDate: end,
      totalDays,
      halfDay,
      halfDayPeriod: halfDay ? halfDayPeriod : '',
      reason,
      ...approvalState,
      actionHistory: [
        {
          action: 'Applied',
          byEmployeeId: req.user._id,
          byName: req.user.name,
          byRole: req.user.role,
          remarks: reason,
          timestamp: new Date(),
        },
      ],
    }], { session });

    // 2. Deduct Balance Immediately (Tentative)
    if (leaveType === 'Paid' || leaveType === 'CompOff') {
      const update = leaveType === 'Paid' 
        ? { $inc: { paidLeaveBalance: -totalDays } } 
        : { $inc: { compOffBalance: -totalDays } };
      
      const updatedEmp = await Employee.findByIdAndUpdate(req.user._id, {
        ...update,
        $push: {
          leaveBalanceHistory: {
            type: 'Deduction',
            leaveType,
            amount: totalDays,
            previousBalance: leaveType === 'Paid' ? employee.paidLeaveBalance : employee.compOffBalance,
            newBalance: (leaveType === 'Paid' ? employee.paidLeaveBalance : employee.compOffBalance) - totalDays,
            remarks: `Leave applied: ${start.toDateString()} to ${end.toDateString()} (Pending approval)`,
            timestamp: new Date(),
          }
        }
      }, { session, new: true });

      if (updatedEmp.paidLeaveBalance < 0 || updatedEmp.compOffBalance < 0) {
         throw new ApiError(400, 'Insufficient balance for this request');
      }
    }

    await session.commitTransaction();

    const populated = await Leave.findById(leave[0]._id).populate('employeeId', 'name employeeCode department role');
    
    if (populated.overallStatus === 'Approved') {
      await syncApprovedLeaveToAttendanceAndPayroll(populated);
    }

    res.status(201).json(new ApiResponse(201, populated, 'Leave applied successfully. Balance deducted.'));
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET MY LEAVES
// ─────────────────────────────────────────────────────────────────────────────
export const getMyLeaves = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, year } = req.query;
  const query = { employeeId: req.user._id };

  if (status && status !== 'All') query.overallStatus = status;
  if (year) {
    query.startDate = {
      $gte: new Date(`${year}-01-01`),
      $lte: new Date(`${year}-12-31`),
    };
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [leaves, total] = await Promise.all([
    Leave.find(query)
      .populate('employeeId', 'name employeeCode department role profileImageUrl')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Leave.countDocuments(query),
  ]);

  // Summary counts
  const [totalCount, approvedCount, pendingCount, rejectedCount, cancelledCount] = await Promise.all([
    Leave.countDocuments({ employeeId: req.user._id }),
    Leave.countDocuments({ employeeId: req.user._id, overallStatus: 'Approved' }),
    Leave.countDocuments({ employeeId: req.user._id, overallStatus: 'Pending' }),
    Leave.countDocuments({ employeeId: req.user._id, overallStatus: 'Rejected' }),
    Leave.countDocuments({ employeeId: req.user._id, overallStatus: 'Cancelled' }),
  ]);

  res.json(
    new ApiResponse(
      200,
      {
        leaves,
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
        summary: { total: totalCount, approved: approvedCount, pending: pendingCount, rejected: rejectedCount, cancelled: cancelledCount },
      },
      'My leaves fetched'
    )
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET PENDING LEAVES (for approvers)
// ─────────────────────────────────────────────────────────────────────────────
export const getPendingLeaves = asyncHandler(async (req, res) => {
  const role = req.user.role;

  let query = {};
  if (['HR', 'SuperUser', 'Director'].includes(role)) {
    query = { hrStatus: 'Pending', overallStatus: 'Pending' };
  } else {
    throw new ApiError(403, 'You do not have approval permissions');
  }

  const leaves = await Leave.find(query)
    .populate('employeeId', 'name employeeCode department role profileImageUrl')
    .sort({ createdAt: -1 });

  res.json(new ApiResponse(200, leaves, 'Pending leaves fetched'));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET ALL LEAVES (admin/HR view)
// ─────────────────────────────────────────────────────────────────────────────
export const getAllLeaves = asyncHandler(async (req, res) => {
  const { page = 1, limit = 30, status, leaveType, department, employeeId, year, month } = req.query;
  const query = {};

  if (status && status !== 'All') query.overallStatus = status;
  if (leaveType) query.leaveType = leaveType;
  if (employeeId) query.employeeId = employeeId;

  if (year || month) {
    const y = year ? parseInt(year) : new Date().getFullYear();
    const m = month ? parseInt(month) : null;
    if (m) {
      query.startDate = {
        $gte: new Date(y, m - 1, 1),
        $lte: new Date(y, m, 0),
      };
    } else {
      query.startDate = {
        $gte: new Date(`${y}-01-01`),
        $lte: new Date(`${y}-12-31`),
      };
    }
  }

  const skip = (Number(page) - 1) * Number(limit);
  let leavesQuery = Leave.find(query)
    .populate('employeeId', 'name employeeCode department role profileImageUrl')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  // Filter by department (requires post-population filter)
  let leaves = await leavesQuery;
  if (department) {
    leaves = leaves.filter((l) => l.employeeId?.department === department);
  }

  const total = await Leave.countDocuments(query);

  res.json(
    new ApiResponse(
      200,
      {
        leaves,
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
      'All leaves fetched'
    )
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET LEAVE BY ID
// ─────────────────────────────────────────────────────────────────────────────
export const getLeaveById = asyncHandler(async (req, res) => {
  const leave = await Leave.findById(req.params.id).populate(
    'employeeId',
    'name employeeCode department role profileImageUrl'
  );
  if (!leave) throw new ApiError(404, 'Leave not found');

  // Owner or approver can view
  const isOwner = leave.employeeId._id.toString() === req.user._id.toString();
  const isApprover = APPROVER_ROLES.includes(req.user.role);
  if (!isOwner && !isApprover) throw new ApiError(403, 'Access denied');

  res.json(new ApiResponse(200, leave, 'Leave fetched'));
});

// ─────────────────────────────────────────────────────────────────────────────
// APPROVE LEAVE
// ─────────────────────────────────────────────────────────────────────────────
export const approveLeave = asyncHandler(async (req, res) => {
  const { remarks = '' } = req.body;
  const leave = await Leave.findById(req.params.id).populate('employeeId', 'name role');
  if (!leave) throw new ApiError(404, 'Leave not found');
  if (leave.overallStatus !== 'Pending') throw new ApiError(400, `Leave is already ${leave.overallStatus}`);

  const approverRole = req.user.role;

  if (['HR', 'SuperUser', 'Director'].includes(approverRole)) {
    if (leave.hrStatus !== 'Pending') throw new ApiError(400, 'Leave is not pending HR approval');
    leave.hrStatus = 'Approved';
    leave.hrRemarks = remarks;
  } else {
    throw new ApiError(403, 'You do not have approval permissions');
  }

  leave.overallStatus = 'Approved';
  leave.currentApproverRole = 'Completed';

  // ── BALANCE ALREADY DEDUCTED DURING APPLICATION ──
  // If Comp-Off, we still want to mark history entries as used (FIFO)
  if (leave.leaveType === 'CompOff') {
    const employee = await Employee.findById(leave.employeeId);
    if (employee && employee.leaveBalanceHistory) {
      let daysToMark = leave.totalDays;
      for (let i = 0; i < employee.leaveBalanceHistory.length; i++) {
        const entry = employee.leaveBalanceHistory[i];
        if (entry.leaveType === 'CompOff' && entry.type === 'Accrual' && !entry.isUsed) {
          entry.isUsed = true;
          entry.usedDate = new Date();
          daysToMark -= entry.amount;
          if (daysToMark <= 0) break;
        }
      }
      await employee.save();
    }
  }

  leave.actionHistory.push({
    action: 'Approved',
    byEmployeeId: req.user._id,
    byName: req.user.name,
    byRole: req.user.role,
    remarks,
    timestamp: new Date(),
  });

  await leave.save();

  const updated = await Leave.findById(leave._id).populate('employeeId', 'name employeeCode department role');

  if (updated.overallStatus === 'Approved') {
    await syncApprovedLeaveToAttendanceAndPayroll(updated);
  }

  res.json(new ApiResponse(200, updated, 'Leave approved successfully'));
});

// ─────────────────────────────────────────────────────────────────────────────
// REJECT LEAVE
// ─────────────────────────────────────────────────────────────────────────────
export const rejectLeave = asyncHandler(async (req, res) => {
  const { remarks = '' } = req.body;
  const leave = await Leave.findById(req.params.id).populate('employeeId', 'name role');
  if (!leave) throw new ApiError(404, 'Leave not found');
  if (leave.overallStatus !== 'Pending') throw new ApiError(400, `Leave is already ${leave.overallStatus}`);

  const approverRole = req.user.role;
  if (!['HR', 'SuperUser', 'Director'].includes(approverRole)) throw new ApiError(403, 'You do not have rejection permissions');

  leave.hrStatus = 'Rejected';
  leave.hrRemarks = remarks;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    leave.overallStatus = 'Rejected';
    leave.currentApproverRole = 'Completed';

    leave.actionHistory.push({
      action: 'Rejected',
      byEmployeeId: req.user._id,
      byName: req.user.name,
      byRole: req.user.role,
      remarks,
      timestamp: new Date(),
    });

    // ── REFUND BALANCE ──
    if (leave.leaveType === 'Paid' || leave.leaveType === 'CompOff') {
      const employee = await Employee.findById(leave.employeeId);
      if (employee) {
        const update = leave.leaveType === 'Paid' 
          ? { $inc: { paidLeaveBalance: leave.totalDays } } 
          : { $inc: { compOffBalance: leave.totalDays } };
        
        const prevBalance = leave.leaveType === 'Paid' ? employee.paidLeaveBalance : employee.compOffBalance;
        
        await Employee.findByIdAndUpdate(employee._id, {
          ...update,
          $push: {
            leaveBalanceHistory: {
              type: 'Adjustment',
              leaveType: leave.leaveType,
              amount: leave.totalDays,
              previousBalance: prevBalance,
              newBalance: prevBalance + leave.totalDays,
              remarks: `Leave rejected: Refund for ${leave.startDate.toDateString()}`,
              timestamp: new Date(),
            }
          }
        }, { session });
      }
    }

    await leave.save({ session });
    await session.commitTransaction();

    const updated = await Leave.findById(leave._id).populate('employeeId', 'name employeeCode department role');
    res.json(new ApiResponse(200, updated, 'Leave rejected and balance refunded'));
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CANCEL LEAVE
// ─────────────────────────────────────────────────────────────────────────────
export const cancelLeave = asyncHandler(async (req, res) => {
  const { reason = '' } = req.body;
  const leave = await Leave.findById(req.params.id);
  if (!leave) throw new ApiError(404, 'Leave not found');

  const isOwner = leave.employeeId.toString() === req.user._id.toString();
  const isAdmin = ADMIN_ROLES.includes(req.user.role);

  if (!isOwner && !isAdmin) throw new ApiError(403, 'You can only cancel your own leave');

  if (leave.overallStatus !== 'Pending') {
    throw new ApiError(400, `Cannot cancel a leave that is already ${leave.overallStatus}`);
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    leave.overallStatus = 'Cancelled';
    leave.cancelledBy = req.user._id;
    leave.cancelledAt = new Date();
    leave.cancelReason = reason;
    leave.currentApproverRole = 'Completed';

    leave.actionHistory.push({
      action: 'Cancelled',
      byEmployeeId: req.user._id,
      byName: req.user.name,
      byRole: req.user.role,
      remarks: reason,
      timestamp: new Date(),
    });

    // ── REFUND BALANCE ──
    if (leave.leaveType === 'Paid' || leave.leaveType === 'CompOff') {
      const employee = await Employee.findById(leave.employeeId);
      if (employee) {
        const update = leave.leaveType === 'Paid' 
          ? { $inc: { paidLeaveBalance: leave.totalDays } } 
          : { $inc: { compOffBalance: leave.totalDays } };
        
        const prevBalance = leave.leaveType === 'Paid' ? employee.paidLeaveBalance : employee.compOffBalance;

        await Employee.findByIdAndUpdate(employee._id, {
          ...update,
          $push: {
            leaveBalanceHistory: {
              type: 'Adjustment',
              leaveType: leave.leaveType,
              amount: leave.totalDays,
              previousBalance: prevBalance,
              newBalance: prevBalance + leave.totalDays,
              remarks: `Leave cancelled: Refund for ${leave.startDate.toDateString()}`,
              timestamp: new Date(),
            }
          }
        }, { session });
      }
    }

    await leave.save({ session });
    await session.commitTransaction();
    res.json(new ApiResponse(200, leave, 'Leave cancelled and balance refunded'));
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET LEAVE STATS (for HR/Director dashboard)
// ─────────────────────────────────────────────────────────────────────────────
export const getLeaveStats = asyncHandler(async (req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [
    totalPending,
    hrPending,
    approvedThisMonth,
    rejectedThisMonth,
    totalThisMonth,
    byType,
    byStatus,
  ] = await Promise.all([
    Leave.countDocuments({ overallStatus: 'Pending' }),
    Leave.countDocuments({ hrStatus: 'Pending', overallStatus: 'Pending' }),
    Leave.countDocuments({ overallStatus: 'Approved', startDate: { $gte: startOfMonth, $lte: endOfMonth } }),
    Leave.countDocuments({ overallStatus: 'Rejected', startDate: { $gte: startOfMonth, $lte: endOfMonth } }),
    Leave.countDocuments({ startDate: { $gte: startOfMonth, $lte: endOfMonth } }),
    Leave.aggregate([{ $group: { _id: '$leaveType', count: { $sum: 1 } } }]),
    Leave.aggregate([{ $group: { _id: '$overallStatus', count: { $sum: 1 } } }]),
  ]);

  res.json(
    new ApiResponse(
      200,
      {
        totalPending,
        pendingByStage: { hr: hrPending },
        thisMonth: { total: totalThisMonth, approved: approvedThisMonth, rejected: rejectedThisMonth },
        byType,
        byStatus,
      },
      'Leave stats fetched'
    )
  );
});

// ─── MONTHLY LEAVE ACCRUAL & SETTLEMENT ──────────────────────────────────────

export const accrueMonthlyLeaves = asyncHandler(async (req, res) => {
  // Manual trigger for testing/debugging — callable by SuperUser/HR
  await processMonthlyLeaveAccrual({ triggeredBy: 'manual-api' });
  res.status(200).json(new ApiResponse(200, null, 'Monthly leave accrual completed successfully'));
});

export const getLeaveBalanceHistory = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.user._id).select('leaveBalanceHistory');
  if (!employee) throw new ApiError(404, 'Employee not found');

  // Sort history by timestamp descending
  const history = (employee.leaveBalanceHistory || []).sort((a, b) => b.timestamp - a.timestamp);

  res.json(new ApiResponse(200, history, 'Leave balance history fetched'));
});



//--- comp off screen -- view the compoffs


export const getCompOffBalanceHistory = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.user._id).select('leaveBalanceHistory compOffBalance');
  if (!employee) throw new ApiError(404, 'Employee not found');

  const now = new Date();

  const history = (employee.leaveBalanceHistory || [])
    .filter((item) => item.leaveType === 'CompOff')
    .map((item) => {
      let status = 'Available';
      if (item.type === 'Accrual') {
        if (item.isUsed) status = 'Used';
        else if (item.expiryDate && new Date(item.expiryDate) < now) status = 'Expired';
      } else {
        status = 'Deduction';
      }

      return {
        _id: item._id,
        type: item.type,
        amount: item.amount,
        earnedDate: item.earnedDate || item.timestamp,
        expiryDate: item.expiryDate,
        status: status,
        usedDate: item.usedDate,
        remarks: item.remarks,
        timestamp: item.timestamp,
        newBalance: item.newBalance
      };
    })
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  res.json(new ApiResponse(200, { history, currentBalance: employee.compOffBalance }, 'Comp-Off balance history fetched'));
});

/**
 * Manually adjust leave balance (Admin/HR only)
 */
export const adjustLeaveBalance = asyncHandler(async (req, res) => {
  const { employeeId, leaveType, amount, remarks } = req.body;

  if (!employeeId || !leaveType || amount === undefined) {
    throw new ApiError(400, 'employeeId, leaveType, and amount are required');
  }

  const employee = await Employee.findById(employeeId);
  if (!employee) throw new ApiError(404, 'Employee not found');

  const prevBalance = leaveType === 'Paid' ? employee.paidLeaveBalance : employee.compOffBalance;
  const newBalance = prevBalance + Number(amount);

  const update = leaveType === 'Paid' 
    ? { paidLeaveBalance: newBalance } 
    : { compOffBalance: newBalance };

  employee.set(update);
  employee.leaveBalanceHistory.push({
    type: 'Adjustment',
    leaveType,
    amount: Math.abs(amount),
    previousBalance: prevBalance,
    newBalance: newBalance,
    remarks: remarks || 'Administrative adjustment',
    timestamp: new Date(),
  });

  await employee.save();

  res.json(new ApiResponse(200, employee, `Balance adjusted successfully. New ${leaveType} balance: ${newBalance}`));
});