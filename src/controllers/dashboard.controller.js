import { Employee } from '../models/Employee.model.js';
import { Attendance } from '../models/Attendance.model.js';
import { Leave } from '../models/Leave.model.js';
import { Holiday } from '../models/Holiday.model.js';
import { Announcement } from '../models/Announcement.model.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiResponse } from '../utils/ApiResponse.js';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
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

const startOfMonth = (date = new Date()) => {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
};

// ─── HR DASHBOARD STATS ──────────────────────────────────────────────────────
export const getHRDashboardStats = asyncHandler(async (req, res) => {
  const today = startOfDay();
  const todayEnd = endOfDay();
  const currentMonthStart = startOfMonth();

  // 1. Employee Statistics
  const [
    totalEmployees,
    activeEmployees,
    inactiveEmployees,
    newJoinersThisMonth
  ] = await Promise.all([
    Employee.countDocuments(),
    Employee.countDocuments({ status: 'Active' }),
    Employee.countDocuments({ status: 'Inactive' }),
    Employee.countDocuments({ 
      joiningDate: { $gte: currentMonthStart },
      status: 'Active'
    })
  ]);

  // 2. Attendance Stats (Today)
  const [
    presentToday,
    lateCheckinsToday,
    wfhToday,
    fieldToday,
    presentEmployees,
  ] = await Promise.all([
    Attendance.countDocuments({ date: { $gte: today, $lte: todayEnd }, status: { $in: ['P', 'AUTO', 'Coff'] } }),
    Attendance.countDocuments({ date: { $gte: today, $lte: todayEnd }, isLate: true }),
    Attendance.countDocuments({ date: { $gte: today, $lte: todayEnd }, workMode: 'WFH', status: { $in: ['P', 'AUTO', 'Coff'] } }),
    Attendance.countDocuments({ date: { $gte: today, $lte: todayEnd }, workMode: 'Field', status: { $in: ['P', 'AUTO', 'Coff'] } }),
    Attendance.find({ date: { $gte: today, $lte: todayEnd }, status: { $in: ['P', 'AUTO', 'Coff'] } })
      .populate('employeeId', 'name employeeCode profileImageUrl department')
      .sort({ inTime: -1 })
      .limit(10)
  ]);

  // 3. On Leave Stats (Today)
  const leavesToday = await Leave.find({
    startDate: { $lte: todayEnd },
    endDate: { $gte: today },
    overallStatus: 'Approved'
  }).populate('employeeId', 'name employeeCode profileImageUrl');

  // 4. Pending Actions
  const [pendingLeaves, pendingCorrections] = await Promise.all([
    Leave.countDocuments({ overallStatus: 'Pending' }),
    Attendance.countDocuments({ correctionRequested: true, correctionStatus: { $ne: 'Approved' } })
  ]);

  // 5. Gender Distribution
  const genderStats = await Employee.aggregate([
    { $match: { status: 'Active' } },
    { $group: { _id: '$gender', count: { $sum: 1 } } }
  ]);

  // 6. Recent Employee Activities (Last 5 New Joiners or Updates)
  const recentEmployees = await Employee.find({ status: 'Active' })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('name employeeCode joiningDate department profileImageUrl');

  // 7. Birthdays (Today & Tomorrow)
  const tMonth = today.getMonth() + 1;
  const tDay = today.getDate();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const tmMonth = tomorrow.getMonth() + 1;
  const tmDay = tomorrow.getDate();

  const [todayBirthdays, tomorrowBirthdays] = await Promise.all([
    Employee.find({
      status: 'Active',
      $expr: {
        $and: [
          { $eq: [{ $month: '$dateOfBirth' }, tMonth] },
          { $eq: [{ $dayOfMonth: '$dateOfBirth' }, tDay] }
        ]
      }
    }).select('name employeeCode profileImageUrl department'),
    Employee.find({
      status: 'Active',
      $expr: {
        $and: [
          { $eq: [{ $month: '$dateOfBirth' }, tmMonth] },
          { $eq: [{ $dayOfMonth: '$dateOfBirth' }, tmDay] }
        ]
      }
    }).select('name employeeCode profileImageUrl department')
  ]);

  // 8. Attendance Trends (Last 7 Days)
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    last7Days.push(startOfDay(d));
  }

  const attendanceTrends = await Attendance.aggregate([
    { $match: { date: { $gte: last7Days[0], $lte: todayEnd }, status: { $in: ['P', 'AUTO', 'Coff'] } } },
    {
      $group: {
        _id: {
          year: { $year: "$date" },
          month: { $month: "$date" },
          day: { $dayOfMonth: "$date" }
        },
        presentCount: { $sum: 1 },
        actualDate: { $first: "$date" }
      }
    },
    { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } }
  ]);

  // Ensure all 7 days are present in the trend
  const formattedTrends = last7Days.map(date => {
    const found = attendanceTrends.find(t => {
      const d = new Date(t.actualDate);
      return d.getFullYear() === date.getFullYear() &&
             d.getMonth() === date.getMonth() &&
             d.getDate() === date.getDate();
    });
    return {
      _id: date,
      presentCount: found ? found.presentCount : 0
    };
  });

  // 9. Leave Trends (Last 6 Months)
  const sixMonthsAgo = new Date(today);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);

  const leaveTrends = await Leave.aggregate([
    { $match: { startDate: { $gte: sixMonthsAgo }, overallStatus: 'Approved' } },
    {
      $group: {
        _id: { month: { $month: '$startDate' }, year: { $year: '$startDate' } },
        count: { $sum: 1 }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } }
  ]);

  // 10. Employees Without Attendance Today (Active but no record or status 'A')
  // First get all active employees
  const allActiveEmps = await Employee.find({ status: 'Active' }).select('_id name employeeCode');
  
  // Get IDs of employees who are Present, on Leave, or it's their Week Off/Holiday
  const accountedEmpIds = await Attendance.find({ 
    date: { $gte: today, $lte: todayEnd }, 
    status: { $in: ['P', 'Coff', 'H', 'WO', 'L', 'AUTO'] } 
  }).distinct('employeeId');

  // Also get IDs of employees who have an approved leave today (in case attendance record isn't synced yet)
  const onLeaveEmpIds = leavesToday.map(l => l.employeeId?._id?.toString());

  const absentEmps = allActiveEmps.filter(emp => {
    const empIdStr = emp._id.toString();
    return !accountedEmpIds.map(id => id.toString()).includes(empIdStr) && 
           !onLeaveEmpIds.includes(empIdStr);
  });

  res.json(new ApiResponse(200, {
    employeeStats: {
      total: totalEmployees,
      active: activeEmployees,
      inactive: inactiveEmployees,
      newJoiners: newJoinersThisMonth
    },
    attendanceToday: {
      present: presentToday,
      absent: absentEmps.length,
      late: lateCheckinsToday,
      wfh: wfhToday,
      field: fieldToday,
      presentEmployeesList: presentEmployees,
      absentEmployees: absentEmps.slice(0, 10) // Limit to 10 for quick view
    },
    leaveStats: {
      onLeaveToday: leavesToday.length,
      onLeaveEmployees: leavesToday,
      pendingLeaves,
      pendingCorrections
    },
    birthdays: {
      today: todayBirthdays,
      tomorrow: tomorrowBirthdays
    },
    genderDistribution: genderStats,
    recentActivities: recentEmployees,
    trends: {
      attendance: formattedTrends,
      leaves: leaveTrends
    }
  }, 'HR Dashboard stats fetched successfully'));
});

// ─── EMPLOYEE DASHBOARD STATS (NEW UNIFIED API) ──────────────────────────────
export const getEmployeeDashboardStats = asyncHandler(async (req, res) => {
  const employeeId = req.user._id;
  const today = startOfDay();
  const todayEnd = endOfDay();
  const currentMonthStart = startOfMonth();
  const now = new Date();

  // Concurrent Optimized Database Queries
  const [
    todayRecord,
    monthlySummary,
    todayBirthdays,
    tomorrowBirthdays,
    upcomingHolidays,
    pendingLeavesCount,
    employeeInfo,
    announcements
  ] = await Promise.all([
    // 1. Today's Attendance Record
    Attendance.findOne({
      employeeId,
      date: { $gte: today, $lte: todayEnd }
    }),

    // 2. Monthly Summary aggregation (only for the current month)
    Attendance.aggregate([
      {
        $match: {
          employeeId,
          date: { $gte: currentMonthStart, $lte: todayEnd }
        }
      },
      {
        $group: {
          _id: null,
          present: { $sum: { $cond: [{ $in: ["$status", ["P", "AUTO", "Coff"]] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ["$status", "A"] }, 1, 0] } },
          late: { $sum: { $cond: ["$isLate", 1, 0] } },
          totalHours: { $sum: { $ifNull: ["$totalHours", 0] } }
        }
      }
    ]),

    // 3. Today's Birthdays
    Employee.find({
      status: 'Active',
      $expr: {
        $and: [
          { $eq: [{ $month: '$dateOfBirth' }, today.getMonth() + 1] },
          { $eq: [{ $dayOfMonth: '$dateOfBirth' }, today.getDate()] }
        ]
      }
    }).select('name employeeCode profileImageUrl department dateOfBirth'),

    // 4. Tomorrow's Birthdays
    Employee.find({
      status: 'Active',
      $expr: {
        $and: [
          { $eq: [{ $month: '$dateOfBirth' }, new Date(Date.now() + 86400000).getMonth() + 1] },
          { $eq: [{ $dayOfMonth: '$dateOfBirth' }, new Date(Date.now() + 86400000).getDate()] }
        ]
      }
    }).select('name employeeCode profileImageUrl department dateOfBirth'),

    // 5. Upcoming Holidays (next 5)
    Holiday.find({
      date: { $gte: today }
    })
      .sort({ date: 1 })
      .limit(5)
      .select('date name type description'),

    // 6. Pending Leaves Count
    Leave.countDocuments({
      employeeId,
      overallStatus: 'Pending'
    }),

    // 7. Fresh Employee balances
    Employee.findById(employeeId).select('paidLeaveBalance compOffBalance'),

    // 8. Active Targeted Announcements (Notice Board)
    Announcement.find({
      isActive: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      $and: [
        {
          $or: [
            { targetType: 'All' },
            { targetType: 'Department', targetDepartments: req.user.department },
            { targetType: 'Role', targetRoles: req.user.role },
            { targetType: 'Employee', targetEmployees: employeeId },
          ]
        }
      ]
    })
      .populate('createdBy', 'name role profileImageUrl')
      .sort({ priority: -1, createdAt: -1 })
      .limit(3)
  ]);

  // Format monthly stats safely
  const stats = monthlySummary[0] || { present: 0, absent: 0, late: 0, totalHours: 0 };

  res.json(
    new ApiResponse(
      200,
      {
        todayRecord,
        monthlySummary: {
          present: stats.present,
          absent: stats.absent,
          late: stats.late,
          totalHours: stats.totalHours,
        },
        birthdays: {
          today: todayBirthdays,
          tomorrow: tomorrowBirthdays
        },
        upcomingHolidays,
        leaveSummary: {
          paidLeaveBalance: employeeInfo?.paidLeaveBalance || 0,
          compOffBalance: employeeInfo?.compOffBalance || 0,
          pendingLeavesCount
        },
        announcements
      },
      'Employee Dashboard stats fetched successfully'
    )
  );
});

