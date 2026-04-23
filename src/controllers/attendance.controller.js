import { Attendance } from '../models/Attendance.model.js';
import { Employee } from '../models/Employee.model.js';
import { Holiday } from '../models/Holiday.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isWithinOffice } from '../services/geo.service.js';
import { config } from '../config/index.js';

// Helper: get start-of-day in local time
const startOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

// ─── CHECK IN ─────────────────────────────────────────────────────────────────
export const checkIn = asyncHandler(async (req, res) => {
  const { latitude, longitude, workMode = 'Office' } = req.body;
  const employee = req.user;

  const isBypassEmployee = employee.employeeCode === 'IA00117';

  if (!isBypassEmployee && workMode === 'Office') {
    if (latitude == null || longitude == null) {
      throw new ApiError(400, 'Location coordinates are required for Office check-in');
    }

    // ── GEO VALIDATION ──
    const geoCheck = isWithinOffice(parseFloat(latitude), parseFloat(longitude));
    if (!geoCheck.isValid) {
      throw new ApiError(
        400,
        `You are outside office premises (${geoCheck.distance}m away). Must be within ${config.office.radiusMeters}m.`
      );
    }
  }

  const today = startOfDay();

  // ── BLOCK DUPLICATE CHECK-IN ──
  const existing = await Attendance.findOne({
    employeeCode: employee.employeeCode,
    date: today,
  });

  if (existing?.inTime) {
    throw new ApiError(400, 'Already checked in today');
  }

  const now = new Date();

  // ── LATE CHECK (standard 9:30 AM start) ──
  const lateThreshold = new Date(today);
  lateThreshold.setHours(9, 30, 0, 0);
  const isLate = now > lateThreshold;
  const lateMinutes = isLate ? Math.round((now - lateThreshold) / 60000) : 0;

  let attendance;
  if (existing) {
    existing.inTime = now;
    existing.isGeoAttendance = true;
    existing.checkInLatitude = latitude != null ? parseFloat(latitude) : null;
    existing.checkInLongitude = longitude != null ? parseFloat(longitude) : null;
    existing.workMode = workMode;
    existing.status = 'P';
    existing.isLate = isLate;
    existing.lateMinutes = lateMinutes;
    existing.correctionRequested = false;
    existing.correctionStatus = 'None';

    if (latitude != null && longitude != null) {
      existing.locationHistory = [{
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        timestamp: now
      }];
    }

    attendance = await existing.save();
  } else {
    attendance = await Attendance.create({
      employeeId: employee._id,
      employeeCode: employee.employeeCode,
      employeeName: employee.name,
      date: today,
      inTime: now,
      status: 'P',
      isGeoAttendance: true,
      checkInLatitude: latitude != null ? parseFloat(latitude) : null,
      checkInLongitude: longitude != null ? parseFloat(longitude) : null,
      workMode,
      locationHistory: (latitude != null && longitude != null) ? [{
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        timestamp: now
      }] : [],
      isLate,
      lateMinutes,
      correctionStatus: 'None',
    });
  }

  res.status(200).json(
    new ApiResponse(200, { attendance, checkedInAt: now }, 'Checked in successfully')
  );
});

// ─── CHECK OUT ────────────────────────────────────────────────────────────────
export const checkOut = asyncHandler(async (req, res) => {
  const { latitude, longitude } = req.body;
  const employee = req.user;

  const today = startOfDay();
  const attendance = await Attendance.findOne({
    employeeCode: employee.employeeCode,
    date: today,
  });

  if (!attendance?.inTime) {
    throw new ApiError(400, 'No check-in found for today. Please check in first.');
  }

  const isBypassEmployee = employee.employeeCode === 'IA00117';

  if (!isBypassEmployee && attendance.workMode === 'Office') {
    if (latitude == null || longitude == null) {
      throw new ApiError(400, 'Location coordinates are required for Office check-out');
    }

    // ── GEO VALIDATION ──
    const geoCheck = isWithinOffice(parseFloat(latitude), parseFloat(longitude));
    if (!geoCheck.isValid) {
      throw new ApiError(
        400,
        `You are outside office premises (${geoCheck.distance}m away). Must be within ${config.office.radiusMeters}m.`
      );
    }
  }
  if (attendance.outTime) {
    throw new ApiError(400, 'Already checked out today');
  }

  const now = new Date();
  const workedMs = now - attendance.inTime;
  const totalMinutes = Math.round(workedMs / 60000);
  const totalHours = parseFloat((workedMs / 3600000).toFixed(2));

  // ── SHIFT: Mon-Fri = 8.5 hrs (510 min), Sat = 7 hrs (420 min) ──
  const dayOfWeek = now.getDay();
  const shiftMinutes = dayOfWeek === 6 ? 420 : 510;

  let overtimeMinutes = 0;
  let shortfallMinutes = 0;
  if (totalMinutes >= shiftMinutes) {
    overtimeMinutes = totalMinutes - shiftMinutes;
  } else {
    shortfallMinutes = shiftMinutes - totalMinutes;
  }

  const { todayWork, pendingWork, issuesFaced, reportParticipants } = req.body;

  attendance.outTime = now;
  attendance.totalHours = totalHours;
  attendance.totalMinutes = totalMinutes;
  attendance.checkOutLatitude = latitude != null ? parseFloat(latitude) : null;
  attendance.checkOutLongitude = longitude != null ? parseFloat(longitude) : null;

  // Save checkout report fields
  attendance.todayWork = todayWork;
  attendance.pendingWork = pendingWork;
  attendance.issuesFaced = issuesFaced;
  attendance.reportParticipants = reportParticipants;

  // ── COMP-OFF EARNING LOGIC ──
  const isSunday = today.getDay() === 0;
  const isHoliday = await Holiday.findOne({ date: today });

  if ((isSunday || isHoliday) && !attendance.isCompOffCredited) {
    const emp = await Employee.findById(employee._id);
    if (emp) {
      emp.compOffBalance = (emp.compOffBalance || 0) + 1;
      await emp.save();
      attendance.isCompOffCredited = true;
      attendance.status = 'Coff'; // Mark as Comp-Off day
    }
  }

  if (latitude != null && longitude != null) {
    attendance.locationHistory.push({
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      timestamp: now
    });
  }

  await attendance.save();

  res.status(200).json(
    new ApiResponse(
      200,
      {
        attendance,
        checkedOutAt: now,
        totalHours,
        totalMinutes,
        overtimeMinutes,
        shortfallMinutes,
      },
      'Checked out successfully'
    )
  );
});

// ─── TRACK LOCATION ──────────────────────────────────────────────────────────
export const trackLocation = asyncHandler(async (req, res) => {
  const { latitude, longitude } = req.body;
  const employee = req.user;

  if (latitude == null || longitude == null) {
    throw new ApiError(400, 'Latitude and longitude are required');
  }

  const today = startOfDay();
  const attendance = await Attendance.findOne({
    employeeCode: employee.employeeCode,
    date: today,
    inTime: { $ne: null },
    outTime: null // Only track if checked in and not checked out
  });

  if (!attendance) {
    throw new ApiError(404, 'Active attendance record not found for today');
  }

  // Only track for Field employees (optionally WFH too, but plan specifically said only for Field tracking)
  if (attendance.workMode !== 'Field') {
    return res.status(200).json(new ApiResponse(200, {}, 'Tracking skipped for non-field work mode'));
  }

  attendance.locationHistory.push({
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    timestamp: new Date()
  });

  await attendance.save();

  res.status(200).json(new ApiResponse(200, { locationHistoryLength: attendance.locationHistory.length }, 'Location tracked successfully'));
});

// ─── TODAY'S STATUS ───────────────────────────────────────────────────────────
export const getTodayStatus = asyncHandler(async (req, res) => {
  const today = startOfDay();
  const record = await Attendance.findOne({
    employeeCode: req.user.employeeCode,
    date: today,
  });

  const office = {
    lat: config.office.latitude,
    lng: config.office.longitude,
    radius: config.office.radiusMeters,
  };

  res.json(new ApiResponse(200, { record, date: today, office }, 'Today status fetched'));
});

// ─── MY ATTENDANCE SUMMARY ────────────────────────────────────────────────────
export const getMySummary = asyncHandler(async (req, res) => {
  const employee = req.user;
  const { from, to } = req.query;

  const start = from ? startOfDay(new Date(from)) : startOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const end = to ? endOfDay(new Date(to)) : endOfDay(new Date());

  const records = await Attendance.find({
    employeeCode: employee.employeeCode,
    date: { $gte: start, $lte: end },
  }).sort({ date: -1 });

  // ── Build daily summary ──
  const summary = {
    present: 0,
    absent: 0,
    weekOff: 0,
    late: 0,
    totalHours: 0,
  };

  const dailyList = [];
  let current = new Date(start);

  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    const record = records.find((r) => r.date.toISOString().split('T')[0] === dateStr);
    const dow = current.getDay();

    if (dow === 0) {
      // Sunday = Week Off
      dailyList.push({ date: new Date(current), status: 'WO', isWeekOff: true });
      summary.weekOff++;
    } else if (record) {
      if (record.isLate) summary.late++;
      if (record.inTime) summary.present++;
      summary.totalHours += record.totalHours || 0;
      dailyList.push(record);
    } else {
      // No record = Absent
      dailyList.push({ date: new Date(current), status: 'A', isAbsent: true });
      summary.absent++;
    }

    current.setDate(current.getDate() + 1);
  }

  res.json(
    new ApiResponse(200, { summary, records: dailyList }, 'Attendance summary fetched')
  );
});


// --------------------------------- employee attendance detail for the selected date

// Add this function after existing exports in attendance.controller.js

// ─── FETCH ATTENDANCE BY DATE (ALL ACTIVE EMPLOYEES) ─────────────────────────
// Add this function after existing exports in attendance.controller.js

// ─── FETCH ATTENDANCE BY DATE (PAGINATED & SEARCHABLE) ─────────────────────────
export const getAttendanceByDate = asyncHandler(async (req, res) => {
  const { date, page = 1, limit = 10, search = '' } = req.query;

  if (!date) {
    throw new ApiError(400, 'Date query parameter is required (YYYY-MM-DD)');
  }

  // ✅ FIX 1: Proper date range (NO external dependency)
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  // ✅ Employee filter
  let employeeFilter = { status: 'Active' };

  if (search) {
    employeeFilter.$or = [
      { employeeCode: { $regex: search, $options: 'i' } },
      { name: { $regex: search, $options: 'i' } }
    ];
  }

  const totalEmployees = await Employee.countDocuments(employeeFilter);

  const employees = await Employee.find(employeeFilter)
    .skip(skip)
    .limit(limitNum)
    .lean();

  if (!employees.length) {
    return res.json(new ApiResponse(200, [], {
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalEmployees,
        totalPages: Math.ceil(totalEmployees / limitNum)
      }
    }, 'No employees found'));
  }

  // ✅ FIX 2: Use employeeId instead of employeeCode
  const employeeIds = employees.map(emp => emp._id);

  // ✅ FIX 3: Correct date query
  const attendanceRecords = await Attendance.find({
    employeeId: { $in: employeeIds },
    date: { $gte: start, $lte: end }
  }).lean();

  // ✅ Create map for fast lookup (O(1))
  const attendanceMap = {};
  attendanceRecords.forEach(record => {
    attendanceMap[record.employeeId.toString()] = record;
  });

  // ✅ Final result
  const result = employees.map(emp => {
    const record = attendanceMap[emp._id.toString()] || {};

    return {
      employeeCode: emp.employeeCode,
      employeeName: emp.name,
      date: start,

      checkInTime: record.inTime || null,
      checkOutTime: record.outTime || null,
      totalHours: record.totalHours || 0,

      status: record.status || 'A',
      workMode: record.workMode || 'Office',
      locationHistory: record.locationHistory || [],

      location: {
        latitude: record.checkInLatitude || null,
        longitude: record.checkInLongitude || null
      }
    };
  });

  res.status(200).json(new ApiResponse(200, result, {
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: totalEmployees,
      totalPages: Math.ceil(totalEmployees / limitNum)
    }
  }, `Attendance for ${date} fetched successfully`));
});

// ─── ADMIN: ALL ATTENDANCE LIST ───────────────────────────────────────────────
export const getAdminAttendanceList = asyncHandler(async (req, res) => {
  const { from, to, search, statusFilter, page = 1, limit = 50 } = req.query;

  const today = startOfDay();
  const start = from ? startOfDay(new Date(from)) : today;
  const end = to ? endOfDay(new Date(to)) : endOfDay(new Date());

  const query = { date: { $gte: start, $lte: end } };

  if (search) {
    const employees = await Employee.find({
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { employeeCode: { $regex: search, $options: 'i' } },
      ],
    }).select('employeeCode');
    query.employeeCode = { $in: employees.map((e) => e.employeeCode) };
  }

  if (statusFilter && statusFilter !== 'All') {
    if (statusFilter === 'Completed') {
      query.outTime = { $ne: null };
    } else if (statusFilter === 'NotCheckedOut') {
      query.inTime = { $ne: null };
      query.outTime = null;
    } else {
      query.status = statusFilter;
    }
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [records, total] = await Promise.all([
    Attendance.find(query).sort({ date: -1 }).skip(skip).limit(Number(limit)),
    Attendance.countDocuments(query),
  ]);

  res.json(
    new ApiResponse(
      200,
      { records, total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / limit) },
      'Attendance list fetched'
    )
  );
});

// ─── MARK REPORT AS READ ──────────────────────────────────────────────────────
export const markReportAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  const attendance = await Attendance.findById(id);
  if (!attendance) {
    throw new ApiError(404, 'Attendance record not found');
  }

  if (!attendance.reportReadBy.includes(userId)) {
    attendance.reportReadBy.push(userId);
    await attendance.save();
  }

  res.json(new ApiResponse(200, attendance, 'Report marked as read'));
});

// ─── ATTENDANCE CORRECTION ───────────────────────────────────────────────────

export const requestCorrection = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason, requestedInTime, requestedOutTime, proofUrl } = req.body;

  if (!reason || !requestedInTime || !requestedOutTime) {
    throw new ApiError(400, 'Reason and both requested times are required');
  }

  const attendance = await Attendance.findById(id);
  if (!attendance) {
    throw new ApiError(404, 'Attendance record not found');
  }

  // ── VALIDATION: NO CORRECTION FOR ABSENT, HOLIDAY, WEEKOFF ──
  if (['A', 'H', 'WO'].includes(attendance.status)) {
    throw new ApiError(400, `Correction not allowed for ${attendance.status} days`);
  }

  attendance.correctionRequested = true;

  // ── ROLE-BASED ROUTING ──
  const role = req.user.role;
  let assignedStatus = 'Pending_HR';
  if (role === 'HR') assignedStatus = 'Pending_GM';
  else if (role === 'GM' || role === 'General Manager') assignedStatus = 'Pending_VP';
  else if (role === 'VP' || role === 'Vice President') assignedStatus = 'Pending_Director';
  else if (role === 'Director') assignedStatus = 'Approved'; // Self-approved

  attendance.correctionStatus = assignedStatus;
  attendance.correctionReason = reason;
  attendance.correctionProofUrl = proofUrl;
  attendance.requestedInTime = new Date(requestedInTime);
  attendance.requestedOutTime = new Date(requestedOutTime);
  attendance.correctionRequestedOn = new Date();

  attendance.correctionHistory.push({
    action: 'Requested',
    byRole: role,
    byEmployeeId: req.user._id,
    remark: reason
  });

  // If Director, auto-approve immediately
  if (assignedStatus === 'Approved') {
    attendance.inTime = attendance.requestedInTime;
    attendance.outTime = attendance.requestedOutTime;
    const workedMs = attendance.outTime - attendance.inTime;
    attendance.totalMinutes = Math.round(workedMs / 60000);
    attendance.totalHours = parseFloat((workedMs / 3600000).toFixed(2));
    attendance.status = 'P';
    attendance.correctionRequested = false;
    attendance.correctionHistory.push({
      action: 'Approved',
      byRole: role,
      byEmployeeId: req.user._id,
      remark: 'Auto-approved (Self Corrected)'
    });
  }

  await attendance.save();
  const msg = assignedStatus === 'Approved' ? 'Correction auto-approved' : `Correction request submitted to ${assignedStatus.split('_')[1]}`;
  res.status(200).json(new ApiResponse(200, attendance, msg));
});

export const approveCorrection = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { remark } = req.body;
  const approver = req.user;

  const attendance = await Attendance.findById(id);
  if (!attendance) {
    throw new ApiError(404, 'Attendance record not found');
  }

  const currentStatus = attendance.correctionStatus;

  // ── ROLE VALIDATION ──
  const roleSteps = {
    'Pending_HR': 'HR',
    'Pending_GM': 'GM',
    'Pending_VP': 'VP',
    'Pending_Director': 'Director'
  };

  if (roleSteps[currentStatus] !== approver.role && approver.role !== 'SuperUser') {
    throw new ApiError(403, `You are not authorized to approve at ${currentStatus} stage`);
  }

  // ── 1-STEP PROGRESSION LOGIC ──
  // Based on requirements, once the targeted approver accepts, the request is closed immediately.
  const nextStatus = 'Approved';
  attendance.correctionStatus = nextStatus;

  attendance.correctionHistory.push({
    action: 'Approved',
    byRole: approver.role,
    byEmployeeId: approver._id,
    remark: remark || 'Approved'
  });

  // ── FINAL APPROVAL: UPDATE ATTENDANCE ──
  attendance.inTime = attendance.requestedInTime;
  attendance.outTime = attendance.requestedOutTime;

  // Recalculate hours
  const workedMs = attendance.outTime - attendance.inTime;
  attendance.totalMinutes = Math.round(workedMs / 60000);
  attendance.totalHours = parseFloat((workedMs / 3600000).toFixed(2));

  // Status update logic
  attendance.status = 'P';
  attendance.correctionRequested = false;

  await attendance.save();
  res.status(200).json(new ApiResponse(200, attendance, 'Correction approved successfully'));
});

export const rejectCorrection = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { remark } = req.body;
  const approver = req.user;

  const attendance = await Attendance.findById(id);
  if (!attendance) {
    throw new ApiError(404, 'Attendance record not found');
  }

  attendance.correctionStatus = 'Rejected';
  attendance.correctionRequested = false;

  attendance.correctionHistory.push({
    action: 'Rejected',
    byRole: approver.role,
    byEmployeeId: approver._id,
    remark: remark || 'Rejected'
  });

  await attendance.save();
  res.status(200).json(new ApiResponse(200, attendance, 'Correction request rejected'));
});

export const getPendingCorrections = asyncHandler(async (req, res) => {
  const role = req.user.role;
  let query = { correctionRequested: true };

  if (role !== 'SuperUser') {
    const statusMap = {
      'HR': 'Pending_HR',
      'GM': 'Pending_GM',
      'VP': 'Pending_VP',
      'Director': 'Pending_Director'
    };
    query.correctionStatus = statusMap[role];
  }

  const records = await Attendance.find(query).sort({ correctionRequestedOn: -1 });
  res.status(200).json(new ApiResponse(200, records, 'Pending corrections fetched'));
});






export const getCorrectionHistoryMonthWise = asyncHandler(async (req, res) => {
  const { month, year } = req.query;

  // Validate month and year
  if (!month || !year) {
    throw new ApiError(400, 'Month and year are required query parameters');
  }

  const monthNum = parseInt(month, 10);
  const yearNum = parseInt(year, 10);

  if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
    throw new ApiError(400, 'Invalid month. Must be between 1 and 12');
  }
  if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
    throw new ApiError(400, 'Invalid year');
  }

  // Calculate start and end dates for the given month
  const startDate = new Date(Date.UTC(yearNum, monthNum - 1, 1));
  const endDate = new Date(Date.UTC(yearNum, monthNum, 0, 23, 59, 59, 999));

  // Find attendance records that have a correction request within the month
  const attendanceRecords = await Attendance.find({
    correctionRequestedOn: { $gte: startDate, $lte: endDate }
  })
    .populate({
      path: 'employeeId',
      select: 'name employeeCode', // only needed fields
    })
    .populate({
      path: 'correctionHistory.byEmployeeId',
      select: 'name employeeCode',
    })
    .lean(); // plain JS objects for easier manipulation

  // Transform data into the required format
  const historyData = attendanceRecords.map(record => {
    // Find the final review action (Approved or Rejected) from history
    const reviewEntry = record.correctionHistory
      ?.slice()
      .reverse()
      .find(entry => entry.action === 'Approved' || entry.action === 'Rejected');

    let reviewedBy = null;
    if (reviewEntry) {
      // If the reviewer employee is populated, use their name; otherwise fallback to role
      const reviewerName = reviewEntry.byEmployeeId?.name || reviewEntry.byRole;
      reviewedBy = reviewerName ? `${reviewerName} (${reviewEntry.byRole})` : reviewEntry.byRole;
    }

    // Determine the requested at timestamp
    const requestedAt = record.correctionRequestedOn ||
      record.correctionHistory?.find(h => h.action === 'Requested')?.timestamp;

    return {
      employeeId: record.employeeCode || record.employeeId?.employeeCode,
      name: record.employeeName || record.employeeId?.name,
      date: record.date.toISOString().split('T')[0], // YYYY-MM-DD
      requestedAt: requestedAt ? requestedAt.toISOString() : null,
      status: record.correctionStatus,
      reason: record.correctionReason || '',
      reviewedBy: reviewedBy || '—',
    };
  });

  // Optionally sort by date (most recent first)
  historyData.sort((a, b) => new Date(b.date) - new Date(a.date));

  res.status(200).json(
    new ApiResponse(200, historyData, 'Correction history fetched successfully')
  );
});

