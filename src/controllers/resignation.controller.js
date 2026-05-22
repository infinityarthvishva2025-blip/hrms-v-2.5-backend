import { Resignation } from '../models/Resignation.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';


//  working on the resignation module
const getApprovalChain = (role) => {
  if (['Employee', 'Intern', 'fresher'].includes(role)) {
    return ['Manager', 'HR', 'GM', 'VP', 'Director'];
  }
  if (role === 'Manager') {
    return ['HR', 'GM', 'VP', 'Director'];
  }
  if (role === 'HR') {
    return ['GM', 'VP', 'Director'];
  }
  if (role === 'GM') {
    return ['VP', 'Director'];
  }
  if (role === 'VP') {
    return ['Director'];
  }
  return []; // Director
};

export const applyResignation = asyncHandler(async (req, res) => {
  const { resignationDate, reason, remarks } = req.body;
  const employeeId = req.user._id; // verifyJWT uses req.user
  const role = req.user.role;

  // Check if there is already an active resignation
  const existing = await Resignation.findOne({
    employee: employeeId,
    status: { $in: ['Pending', 'On Hold', 'Sent Back', 'Approved'] }
  });

  if (existing) {
    throw new ApiError(400, 'You already have an active resignation.');
  }

  const noticePeriodDays = 30;
  const rDate = new Date(resignationDate);
  const lWorkingDay = new Date(rDate);
  lWorkingDay.setDate(lWorkingDay.getDate() + noticePeriodDays);

  const approvalChain = getApprovalChain(role);
  let status = 'Pending';
  let currentApproverRole = approvalChain[0] || null;

  if (approvalChain.length === 0) {
    status = 'Approved';
  }

  const resignation = new Resignation({
    employee: employeeId,
    resignationDate: rDate,
    noticePeriodDays,
    lastWorkingDay: lWorkingDay,
    reason,
    remarks,
    status,
    approvalChain,
    currentApprovalLevel: 0,
    currentApproverRole,
    timeline: [
      {
        action: 'Applied',
        actionBy: employeeId,
        role: role,
        comments: 'Resignation Applied',
        updatedStatus: status,
      }
    ]
  });

  await resignation.save();

  res.status(201).json(new ApiResponse(201, resignation, 'Resignation applied successfully'));
});

export const getMyResignations = asyncHandler(async (req, res) => {
  const resignations = await Resignation.find({ employee: req.user._id })
    .populate('employee', 'name employeeCode department position role profileImageUrl')
    .populate('timeline.actionBy', 'name role profileImageUrl')
    .sort({ createdAt: -1 });

  res.status(200).json(new ApiResponse(200, resignations, 'My resignations fetched successfully'));
});

export const getPendingApprovals = asyncHandler(async (req, res) => {
  const role = req.user.role;
  
  let query = {};
  if (role !== 'SuperUser') {
     query = { currentApproverRole: role, status: { $in: ['Pending', 'On Hold'] } };
  } else {
     query = { status: { $in: ['Pending', 'On Hold'] } };
  }

  const resignations = await Resignation.find(query)
    .populate('employee', 'name employeeCode department position role profileImageUrl')
    .populate('timeline.actionBy', 'name role profileImageUrl')
    .sort({ createdAt: -1 });

  res.status(200).json(new ApiResponse(200, resignations, 'Pending approvals fetched successfully'));
});

export const getAllResignations = asyncHandler(async (req, res) => {
  const resignations = await Resignation.find()
    .populate('employee', 'name employeeCode department position role profileImageUrl')
    .populate('timeline.actionBy', 'name role profileImageUrl')
    .sort({ createdAt: -1 });

  res.status(200).json(new ApiResponse(200, resignations, 'All resignations fetched successfully'));
});

export const getResignationById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const resignation = await Resignation.findById(id)
    .populate('employee', 'name employeeCode department position role profileImageUrl')
    .populate('timeline.actionBy', 'name role profileImageUrl');

  if (!resignation) {
    throw new ApiError(404, 'Resignation not found');
  }
  
  res.status(200).json(new ApiResponse(200, resignation, 'Resignation details fetched successfully'));
});

export const takeAction = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action, comments } = req.body;
  const employeeId = req.user._id;
  const role = req.user.role;

  if (!['Approve', 'Reject', 'Put on Hold', 'Send Back', 'Withdraw'].includes(action)) {
    throw new ApiError(400, 'Invalid action');
  }

  const resignation = await Resignation.findById(id).populate('employee', 'name role');
  if (!resignation) {
    throw new ApiError(404, 'Resignation not found');
  }

  if (action === 'Withdraw') {
    if (resignation.employee._id.toString() !== employeeId.toString()) {
       throw new ApiError(403, 'You can only withdraw your own resignation');
    }
    if (!['Pending', 'On Hold', 'Sent Back'].includes(resignation.status)) {
       throw new ApiError(400, 'Cannot withdraw at this stage');
    }
    const prevStatus = resignation.status;
    resignation.status = 'Withdrawn';
    resignation.currentApproverRole = null;
    resignation.timeline.push({
      action: 'Withdrawn',
      actionBy: employeeId,
      role: role,
      comments: comments || 'Withdrawn by employee',
      previousStatus: prevStatus,
      updatedStatus: 'Withdrawn'
    });
    await resignation.save();
    return res.status(200).json(new ApiResponse(200, resignation, 'Resignation withdrawn'));
  }

  if (role !== 'SuperUser' && resignation.currentApproverRole !== role) {
     throw new ApiError(403, `You are not authorized. Pending with: ${resignation.currentApproverRole}`);
  }

  const prevStatus = resignation.status;

  if (action === 'Approve') {
    resignation.currentApprovalLevel += 1;
    if (resignation.currentApprovalLevel >= resignation.approvalChain.length) {
      resignation.status = 'Approved';
      resignation.currentApproverRole = null;
    } else {
      resignation.status = 'Pending';
      resignation.currentApproverRole = resignation.approvalChain[resignation.currentApprovalLevel];
    }
  } else if (action === 'Reject') {
    resignation.status = 'Rejected';
    resignation.currentApproverRole = null;
  } else if (action === 'Put on Hold') {
    resignation.status = 'On Hold';
  } else if (action === 'Send Back') {
    resignation.status = 'Sent Back';
    resignation.currentApprovalLevel = 0;
    resignation.currentApproverRole = null;
  }

  resignation.timeline.push({
    action,
    actionBy: employeeId,
    role: role,
    comments,
    previousStatus: prevStatus,
    updatedStatus: resignation.status
  });

  await resignation.save();

  res.status(200).json(new ApiResponse(200, resignation, `Resignation ${action.toLowerCase()} successfully`));
});

export const updateResignation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { resignationDate, reason, remarks } = req.body;
  const employeeId = req.user._id;

  const resignation = await Resignation.findById(id);
  if (!resignation) throw new ApiError(404, 'Not found');

  if (resignation.employee.toString() !== employeeId.toString()) {
     throw new ApiError(403, 'Unauthorized');
  }

  if (resignation.status !== 'Sent Back') {
     throw new ApiError(400, 'Can only update when sent back');
  }

  const rDate = new Date(resignationDate);
  const lWorkingDay = new Date(rDate);
  lWorkingDay.setDate(lWorkingDay.getDate() + resignation.noticePeriodDays);

  resignation.resignationDate = rDate;
  resignation.lastWorkingDay = lWorkingDay;
  resignation.reason = reason;
  resignation.remarks = remarks;

  resignation.status = 'Pending';
  resignation.currentApprovalLevel = 0;
  resignation.currentApproverRole = resignation.approvalChain[0] || null;

  resignation.timeline.push({
    action: 'Applied',
    actionBy: employeeId,
    role: req.user.role,
    comments: 'Resignation updated and resubmitted',
    previousStatus: 'Sent Back',
    updatedStatus: 'Pending'
  });

  await resignation.save();

  res.status(200).json(new ApiResponse(200, resignation, 'Resignation resubmitted'));
});
