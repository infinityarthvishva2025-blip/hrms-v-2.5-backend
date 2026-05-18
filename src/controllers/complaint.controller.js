import { Complaint } from '../models/Complaint.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Allowed roles for submission (Director cannot submit)
const ALLOWED_SUBMITTER_ROLES = ['Employee', 'Intern', 'Manager', 'GM', 'VP'];

export const submitComplaint = asyncHandler(async (req, res) => {
  const { title, category, description, priority = 'Medium' } = req.body;
  const employeeId = req.user._id;
  const role = req.user.role;

  if (!ALLOWED_SUBMITTER_ROLES.includes(role)) {
    throw new ApiError(403, 'You are not authorized to submit a complaint');
  }

  const complaint = new Complaint({
    employee: employeeId,
    title,
    category,
    description,
    priority,
    status: 'Pending',
    timeline: [
      {
        action: 'Submitted',
        actionBy: employeeId,
        role: role,
        comments: 'Complaint submitted to Director',
        updatedStatus: 'Pending'
      }
    ]
  });

  await complaint.save();

  res
    .status(201)
    .json(new ApiResponse(201, complaint, 'Complaint submitted successfully'));
});

export const getMyComplaints = asyncHandler(async (req, res) => {
  const complaints = await Complaint.find({ employee: req.user._id })
    .populate('employee', 'name employeeCode department position role profileImageUrl')
    .populate('timeline.actionBy', 'name role profileImageUrl')
    .sort({ createdAt: -1 });

  res
    .status(200)
    .json(new ApiResponse(200, complaints, 'Your complaints fetched successfully'));
});

export const getDirectorComplaints = asyncHandler(async (req, res) => {
  if (!['Director', 'SuperUser'].includes(req.user.role)) {
    throw new ApiError(403, 'Access denied. Only Director can view all complaints.');
  }

  const { status, priority, category, search, startDate, endDate, sortBy = 'createdAt', order = 'desc' } = req.query;
  const filter = {};

  if (status && status !== 'All') {
    filter.status = status;
  }
  if (priority && priority !== 'All') {
    filter.priority = priority;
  }
  if (category && category !== 'All') {
    filter.category = category;
  }
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  const sortOptions = {};
  sortOptions[sortBy] = order === 'asc' ? 1 : -1;

  const complaints = await Complaint.find(filter)
    .populate('employee', 'name employeeCode department position role profileImageUrl')
    .populate('timeline.actionBy', 'name role profileImageUrl')
    .sort(sortOptions);

  // Get some stats for the dashboard
  const stats = await Complaint.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  const formattedStats = stats.reduce((acc, curr) => {
    acc[curr._id] = curr.count;
    return acc;
  }, {});

  res
    .status(200)
    .json(new ApiResponse(200, { complaints, stats: formattedStats }, 'Complaints fetched successfully'));
});

export const getComplaintById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const complaint = await Complaint.findById(id)
    .populate('employee', 'name employeeCode department position role profileImageUrl')
    .populate('timeline.actionBy', 'name role profileImageUrl');

  if (!complaint) {
    throw new ApiError(404, 'Complaint not found');
  }

  if (
    complaint.employee._id.toString() !== req.user._id.toString() &&
    !['Director', 'SuperUser'].includes(req.user.role)
  ) {
    throw new ApiError(403, 'You are not authorized to view this complaint');
  }

  res
    .status(200)
    .json(new ApiResponse(200, complaint, 'Complaint details fetched'));
});

export const directorAction = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action, comments, priority } = req.body;
  const userId = req.user._id;
  const role = req.user.role;

  if (!['Director', 'SuperUser'].includes(role)) {
    throw new ApiError(403, 'Only Director can manage complaints');
  }

  const VALID_ACTIONS = ['Acknowledge', 'In Review', 'Resolve', 'Reject', 'Comment', 'Update Priority'];
  if (!VALID_ACTIONS.includes(action)) {
    throw new ApiError(400, `Invalid action. Allowed: ${VALID_ACTIONS.join(', ')}`);
  }

  const complaint = await Complaint.findById(id);
  if (!complaint) {
    throw new ApiError(404, 'Complaint not found');
  }

  const previousStatus = complaint.status;
  let newStatus = complaint.status;
  let actionName = action;

  switch (action) {
    case 'Acknowledge':
      if (complaint.status !== 'Pending') {
        throw new ApiError(400, 'Only pending complaints can be acknowledged');
      }
      newStatus = 'Acknowledged';
      actionName = 'Acknowledged';
      break;
    case 'In Review':
      if (!['Pending', 'Acknowledged'].includes(complaint.status)) {
        throw new ApiError(400, 'Complaint must be Pending or Acknowledged to move to In Review');
      }
      newStatus = 'In Review';
      actionName = 'In Review';
      break;
    case 'Resolve':
      newStatus = 'Resolved';
      actionName = 'Resolved';
      break;
    case 'Reject':
      newStatus = 'Rejected';
      actionName = 'Rejected';
      break;
    case 'Update Priority':
      if (!priority) throw new ApiError(400, 'Priority is required');
      complaint.priority = priority;
      actionName = `Changed priority to ${priority}`;
      break;
    case 'Comment':
      actionName = 'Commented';
      break;
  }

  complaint.status = newStatus;
  if (comments) {
    complaint.directorComments = comments;
  }

  complaint.timeline.push({
    action: actionName,
    actionBy: userId,
    role: role,
    comments: comments || `Director performed: ${action}`,
    previousStatus,
    updatedStatus: newStatus
  });

  await complaint.save();

  res
    .status(200)
    .json(new ApiResponse(200, complaint, `Complaint ${action.toLowerCase()} updated successfully`));
});