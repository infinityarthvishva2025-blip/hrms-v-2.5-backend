import { Announcement } from '../models/Announcement.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// ─────────────────────────────────────────────────────────────────────────────
// CREATE ANNOUNCEMENT (Admin/HR)
// ─────────────────────────────────────────────────────────────────────────────
export const createAnnouncement = asyncHandler(async (req, res) => {
  const {
    title, message, type, priority, targetType,
    targetDepartments, targetRoles, targetEmployees,
    expiresAt, isActive
  } = req.body;

  if (!title || !message || !targetType) {
    throw new ApiError(400, 'Title, message, and targetType are required');
  }

  // Build payload
  const payload = {
    title,
    message,
    type,
    priority,
    targetType,
    createdBy: req.user._id,
  };

  if (targetType === 'Department') payload.targetDepartments = targetDepartments || [];
  if (targetType === 'Role') payload.targetRoles = targetRoles || [];
  if (targetType === 'Employee') payload.targetEmployees = targetEmployees || [];
  
  if (expiresAt) payload.expiresAt = new Date(expiresAt);
  if (isActive !== undefined) payload.isActive = isActive;

  const announcement = await Announcement.create(payload);

  const populated = await Announcement.findById(announcement._id)
    .populate('createdBy', 'name role')
    .populate('targetEmployees', 'name employeeCode');

  res.status(201).json(new ApiResponse(201, populated, 'Announcement created successfully'));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET ALL ANNOUNCEMENTS (Admin/HR Management View)
// ─────────────────────────────────────────────────────────────────────────────
export const getAllAnnouncements = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, type, priority, isActive } = req.query;
  const query = {};

  if (type && type !== 'All') query.type = type;
  if (priority && priority !== 'All') query.priority = priority;
  if (isActive !== undefined) query.isActive = isActive === 'true';

  const skip = (Number(page) - 1) * Number(limit);
  
  const [announcements, total] = await Promise.all([
    Announcement.find(query)
      .populate('createdBy', 'name role profileImageUrl')
      .populate('targetEmployees', 'name employeeCode')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Announcement.countDocuments(query),
  ]);

  res.json(
    new ApiResponse(
      200,
      {
        announcements,
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
      'Announcements fetched successfully'
    )
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET MY ANNOUNCEMENTS (Employee Feed)
// ─────────────────────────────────────────────────────────────────────────────
export const getMyAnnouncements = asyncHandler(async (req, res) => {
  const { department, role, _id: userId } = req.user;
  const now = new Date();

  // Targeting Logic:
  // 1. IsActive is true
  // 2. Not expired (expiresAt is null OR expiresAt > now)
  // 3. Target matches (All OR Dept matches OR Role matches OR Emp ID matches)
  const query = {
    isActive: true,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    $and: [
      {
        $or: [
          { targetType: 'All' },
          { targetType: 'Department', targetDepartments: department },
          { targetType: 'Role', targetRoles: role },
          { targetType: 'Employee', targetEmployees: userId },
        ]
      }
    ]
  };

  const announcements = await Announcement.find(query)
    .populate('createdBy', 'name role profileImageUrl')
    .sort({ priority: -1, createdAt: -1 }); // Urgent first, then newest

  res.json(new ApiResponse(200, announcements, 'My announcements fetched successfully'));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET UNREAD COUNT (For Notification Badge)
// ─────────────────────────────────────────────────────────────────────────────
export const getUnreadCount = asyncHandler(async (req, res) => {
  const { department, role, _id: userId } = req.user;
  const now = new Date();

  const query = {
    isActive: true,
    readBy: { $ne: userId }, // Not in readBy array
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    $and: [
      {
        $or: [
          { targetType: 'All' },
          { targetType: 'Department', targetDepartments: department },
          { targetType: 'Role', targetRoles: role },
          { targetType: 'Employee', targetEmployees: userId },
        ]
      }
    ]
  };

  const count = await Announcement.countDocuments(query);
  res.json(new ApiResponse(200, { unreadCount: count }, 'Unread count fetched'));
});

// ─────────────────────────────────────────────────────────────────────────────
// MARK AS READ (Employee Action)
// ─────────────────────────────────────────────────────────────────────────────
export const markAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  const announcement = await Announcement.findById(id);
  if (!announcement) throw new ApiError(404, 'Announcement not found');

  if (!announcement.readBy.includes(userId)) {
    announcement.readBy.push(userId);
    await announcement.save();
  }

  res.json(new ApiResponse(200, null, 'Marked as read'));
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE ANNOUNCEMENT (Admin/HR)
// ─────────────────────────────────────────────────────────────────────────────
export const updateAnnouncement = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  // Prevent changing creator or tracking fields
  const updates = { ...req.body };
  delete updates.createdBy;
  delete updates.readBy;

  if (updates.expiresAt) {
    updates.expiresAt = new Date(updates.expiresAt);
  }

  // Reset target arrays if targetType is changed to something else
  if (updates.targetType === 'All') {
    updates.targetDepartments = [];
    updates.targetRoles = [];
    updates.targetEmployees = [];
  } else if (updates.targetType === 'Department') {
    updates.targetRoles = [];
    updates.targetEmployees = [];
  } else if (updates.targetType === 'Role') {
    updates.targetDepartments = [];
    updates.targetEmployees = [];
  } else if (updates.targetType === 'Employee') {
    updates.targetDepartments = [];
    updates.targetRoles = [];
  }

  const updated = await Announcement.findByIdAndUpdate(
    id,
    { $set: updates },
    { new: true, runValidators: true }
  )
    .populate('createdBy', 'name role')
    .populate('targetEmployees', 'name employeeCode');

  if (!updated) throw new ApiError(404, 'Announcement not found');

  res.json(new ApiResponse(200, updated, 'Announcement updated successfully'));
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE ANNOUNCEMENT (Admin/HR)
// ─────────────────────────────────────────────────────────────────────────────
export const deleteAnnouncement = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const deleted = await Announcement.findByIdAndDelete(id);
  if (!deleted) throw new ApiError(404, 'Announcement not found');

  res.json(new ApiResponse(200, null, 'Announcement deleted successfully'));
});
