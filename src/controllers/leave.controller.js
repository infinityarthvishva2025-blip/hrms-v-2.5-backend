import { Leave } from '../models/Leave.model.js';
import { Employee } from '../models/Employee.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// ── ROLE CONSTANTS ──
const APPROVER_ROLES = ['SuperUser', 'HR', 'GM', 'VP', 'Director', 'Manager'];
const ADMIN_ROLES = ['SuperUser', 'HR', 'Director'];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set initial approval chain based on the applicant's role.
 * Mirrors the .NET SetApprovalFlow logic.
 */
function buildInitialApprovalState(applicantRole) {
  const base = {
    managerStatus: '-',
    hrStatus: '-',
    gmStatus: '-',
    vpStatus: '-',
    directorStatus: '-',
    overallStatus: 'Pending',
    currentApproverRole: 'Completed',
  };

  switch (applicantRole) {
    case 'Employee':
    case 'Intern':
      return {
        ...base,
        managerStatus: 'Pending',
        hrStatus: 'Pending',
        gmStatus: 'Pending',
        vpStatus: 'Pending',
        currentApproverRole: 'Manager',
      };

    case 'Manager':
      return {
        ...base,
        hrStatus: 'Pending',
        gmStatus: 'Pending',
        vpStatus: 'Pending',
        directorStatus: 'Pending',
        currentApproverRole: 'HR',
      };

    case 'HR':
      return {
        ...base,
        gmStatus: 'Pending',
        vpStatus: 'Pending',
        directorStatus: 'Pending',
        currentApproverRole: 'GM',
      };

    case 'GM':
      return {
        ...base,
        vpStatus: 'Pending',
        directorStatus: 'Pending',
        currentApproverRole: 'VP',
      };

    case 'VP':
      return {
        ...base,
        directorStatus: 'Pending',
        currentApproverRole: 'Director',
      };

    case 'Director':
    case 'SuperUser':
      return {
        ...base,
        overallStatus: 'Approved',
        currentApproverRole: 'Completed',
      };

    default:
      return {
        ...base,
        managerStatus: 'Pending',
        currentApproverRole: 'Manager',
      };
  }
}

/**
 * Calculate total days between two dates (inclusive).
 */
function calcTotalDays(start, end, halfDay) {
  if (halfDay) return 0.5;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Determine next approver role after a successful approval.
 */
function getNextApproverRole(currentRole, leave) {
  const steps = ['Manager', 'HR', 'GM', 'VP', 'Director', 'Completed'];
  const currentIndex = steps.indexOf(currentRole);
  
  for (let i = currentIndex + 1; i < steps.length; i++) {
    const nextRole = steps[i];
    if (nextRole === 'Completed') return 'Completed';
    
    const statusField = `${nextRole.toLowerCase()}Status`;
    if (leave[statusField] === 'Pending') return nextRole;
  }
  
  return 'Completed';
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

  const totalDays = calcTotalDays(start, end, halfDay);
  
  // ── BALANCE VALIDATION ──
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

  const approvalState = buildInitialApprovalState(req.user.role);

  const leave = await Leave.create({
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
  });

  // Auto-complete for Director/SuperUser
  if (approvalState.overallStatus === 'Approved') {
    leave.actionHistory.push({
      action: 'Approved',
      byEmployeeId: req.user._id,
      byName: req.user.name,
      byRole: req.user.role,
      remarks: 'Auto-approved for senior role',
      timestamp: new Date(),
    });
    await leave.save();
  }

  const populated = await Leave.findById(leave._id).populate('employeeId', 'name employeeCode department role');

  res.status(201).json(new ApiResponse(201, populated, 'Leave applied successfully'));
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
  switch (role) {
    case 'Manager':
      query = { managerStatus: 'Pending', overallStatus: 'Pending' };
      break;
    case 'HR':
      query = { managerStatus: { $in: ['Approved', '-'] }, hrStatus: 'Pending', overallStatus: 'Pending' };
      break;
    case 'GM':
      query = { hrStatus: { $in: ['Approved', '-'] }, gmStatus: 'Pending', overallStatus: 'Pending' };
      break;
    case 'VP':
      query = { gmStatus: { $in: ['Approved', '-'] }, vpStatus: 'Pending', overallStatus: 'Pending' };
      break;
    case 'Director':
      query = { vpStatus: { $in: ['Approved', '-'] }, directorStatus: 'Pending', overallStatus: 'Pending' };
      break;
    case 'SuperUser':
      query = { overallStatus: 'Pending' };
      break;
    default:
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

  // Validate correct stage
  switch (approverRole) {
    case 'Manager':
      if (leave.managerStatus !== 'Pending') throw new ApiError(400, 'Leave is not pending Manager approval');
      leave.managerStatus = 'Approved';
      leave.managerRemarks = remarks;
      break;
    case 'HR':
      if (leave.hrStatus !== 'Pending') throw new ApiError(400, 'Leave is not pending HR approval');
      leave.hrStatus = 'Approved';
      leave.hrRemarks = remarks;
      break;
    case 'GM':
      if (leave.gmStatus !== 'Pending') throw new ApiError(400, 'Leave is not pending GM approval');
      leave.gmStatus = 'Approved';
      leave.gmRemarks = remarks;
      break;
    case 'VP':
      if (leave.vpStatus !== 'Pending') throw new ApiError(400, 'Leave is not pending VP approval');
      leave.vpStatus = 'Approved';
      leave.vpRemarks = remarks;
      break;
    case 'Director':
      if (leave.directorStatus !== 'Pending') throw new ApiError(400, 'Leave is not pending Director approval');
      leave.directorStatus = 'Approved';
      leave.directorRemarks = remarks;
      break;
    case 'SuperUser':
      // SuperUser can approve at any stage
      if (leave.managerStatus === 'Pending') leave.managerStatus = 'Approved';
      if (leave.hrStatus === 'Pending') leave.hrStatus = 'Approved';
      if (leave.gmStatus === 'Pending') leave.gmStatus = 'Approved';
      if (leave.vpStatus === 'Pending') leave.vpStatus = 'Approved';
      if (leave.directorStatus === 'Pending') leave.directorStatus = 'Approved';
      break;
    default:
      throw new ApiError(403, 'You do not have approval permissions');
  }

  // Check if all required stages are done
  const nextRole = getNextApproverRole(approverRole === 'SuperUser' ? 'Director' : approverRole, leave);

  if (
    nextRole === 'Completed' ||
    approverRole === 'SuperUser' ||
    ((leave.managerStatus !== 'Pending' || leave.managerStatus === '-') &&
     (leave.hrStatus !== 'Pending' || leave.hrStatus === '-') &&
     (leave.gmStatus !== 'Pending' || leave.gmStatus === '-') &&
     (leave.vpStatus !== 'Pending' || leave.vpStatus === '-') &&
     (leave.directorStatus !== 'Pending' || leave.directorStatus === '-'))
  ) {
    // Final check for overall status
    const allApproved = 
      (leave.managerStatus === 'Approved' || leave.managerStatus === '-') &&
      (leave.hrStatus === 'Approved' || leave.hrStatus === '-') &&
      (leave.gmStatus === 'Approved' || leave.gmStatus === '-') &&
      (leave.vpStatus === 'Approved' || leave.vpStatus === '-') &&
      (leave.directorStatus === 'Approved' || leave.directorStatus === '-');

    if (allApproved) {
      leave.overallStatus = 'Approved';
      leave.currentApproverRole = 'Completed';

      // ── DEDUCT BALANCE ──
      const employee = await Employee.findById(leave.employeeId);
      if (employee) {
        if (leave.leaveType === 'Paid') {
          employee.paidLeaveBalance = Math.max(0, (employee.paidLeaveBalance || 0) - leave.totalDays);
        } else if (leave.leaveType === 'CompOff') {
          employee.compOffBalance = Math.max(0, (employee.compOffBalance || 0) - leave.totalDays);
        }
        await employee.save();
      }
    } else {
      leave.currentApproverRole = nextRole;
    }
  } else {
    leave.currentApproverRole = nextRole;
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
  if (!APPROVER_ROLES.includes(approverRole)) throw new ApiError(403, 'You do not have rejection permissions');

  // Update relevant stage
  switch (approverRole) {
    case 'Manager':
      leave.managerStatus = 'Rejected';
      leave.managerRemarks = remarks;
      break;
    case 'HR':
      leave.hrStatus = 'Rejected';
      leave.hrRemarks = remarks;
      break;
    case 'GM':
      leave.gmStatus = 'Rejected';
      leave.gmRemarks = remarks;
      break;
    case 'VP':
      leave.vpStatus = 'Rejected';
      leave.vpRemarks = remarks;
      break;
    case 'Director':
      leave.directorStatus = 'Rejected';
      leave.directorRemarks = remarks;
      break;
    case 'SuperUser':
      if (leave.managerStatus === 'Pending') leave.managerStatus = 'Rejected';
      if (leave.hrStatus === 'Pending') leave.hrStatus = 'Rejected';
      if (leave.gmStatus === 'Pending') leave.gmStatus = 'Rejected';
      if (leave.vpStatus === 'Pending') leave.vpStatus = 'Rejected';
      if (leave.directorStatus === 'Pending') leave.directorStatus = 'Rejected';
      break;
  }

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

  await leave.save();

  const updated = await Leave.findById(leave._id).populate('employeeId', 'name employeeCode department role');
  res.json(new ApiResponse(200, updated, 'Leave rejected'));
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

  await leave.save();
  res.json(new ApiResponse(200, leave, 'Leave cancelled'));
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
    gmPending,
    directorPending,
    approvedThisMonth,
    rejectedThisMonth,
    totalThisMonth,
    byType,
    byStatus,
  ] = await Promise.all([
    Leave.countDocuments({ overallStatus: 'Pending' }),
    Leave.countDocuments({ managerStatus: 'Pending', overallStatus: 'Pending' }),
    Leave.countDocuments({ managerStatus: { $in: ['Approved', '-'] }, hrStatus: 'Pending', overallStatus: 'Pending' }),
    Leave.countDocuments({ hrStatus: { $in: ['Approved', '-'] }, gmStatus: 'Pending', overallStatus: 'Pending' }),
    Leave.countDocuments({ gmStatus: { $in: ['Approved', '-'] }, vpStatus: 'Pending', overallStatus: 'Pending' }),
    Leave.countDocuments({ vpStatus: { $in: ['Approved', '-'] }, directorStatus: 'Pending', overallStatus: 'Pending' }),
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
        pendingByStage: { hr: hrPending, gm: gmPending, director: directorPending },
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
  // This would typically be called by a CRON job or manually by Admin
  const employees = await Employee.find({ status: 'Active' });
  const now = new Date();
  const currentMonth = now.getMonth(); // 0-11 (April is 3)
  
  const results = {
    credited: 0,
    resetInApril: false
  };

  // 1. Credit 1 Paid Leave for the current month
  for (const emp of employees) {
    emp.paidLeaveBalance = (emp.paidLeaveBalance || 0) + 1;
    await emp.save();
    results.credited++;
  }

  // 2. April Settlement Logic
  if (currentMonth === 3) { // April is month 4 (UTC) or 3 (0-indexed)
    results.resetInApril = true;
  }

  res.status(200).json(new ApiResponse(200, results, 'Monthly leaves accrued successfully'));
});
