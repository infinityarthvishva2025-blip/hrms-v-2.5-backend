import mongoose from 'mongoose';

const ACTION_HISTORY_SCHEMA = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['Applied', 'Approved', 'Rejected', 'Cancelled', 'Remarked'],
      required: true,
    },
    byEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    byName: { type: String },
    byRole: { type: String },
    remarks: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const leaveSchema = new mongoose.Schema(
  {
    // ── APPLICANT ──
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },

    // ── LEAVE DETAILS ──
    leaveType: {
      type: String,
      required: true,
      enum: ['Paid', 'Casual', 'Sick', 'Earned', 'Unpaid', 'CompOff', 'MaternityPaternity', 'Other'],
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalDays: { type: Number, required: true },
    halfDay: { type: Boolean, default: false },
    halfDayPeriod: { type: String, enum: ['Morning', 'Afternoon', ''], default: '' },
    reason: { type: String, required: true, trim: true },

    // ── APPROVAL STATUSES ──
    // "-" means that stage is skipped for this applicant's role
    managerStatus: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', '-'],
      default: 'Pending',
    },
    hrStatus: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', '-'],
      default: 'Pending',
    },
    gmStatus: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', '-'],
      default: 'Pending',
    },
    vpStatus: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', '-'],
      default: 'Pending',
    },
    directorStatus: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', '-'],
      default: 'Pending',
    },

    // ── OVERALL STATUS ──
    overallStatus: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'],
      default: 'Pending',
      index: true,
    },

    // ── CURRENT APPROVAL STAGE ──
    // Tracks which approver role needs to act next
    currentApproverRole: {
      type: String,
      enum: ['Manager', 'HR', 'GM', 'VP', 'Director', 'Completed', '-'],
      default: 'Manager',
    },

    // ── REMARKS ──
    managerRemarks: { type: String, default: '' },
    hrRemarks: { type: String, default: '' },
    gmRemarks: { type: String, default: '' },
    vpRemarks: { type: String, default: '' },
    directorRemarks: { type: String, default: '' },

    // ── CANCELLATION ──
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    cancelledAt: { type: Date },
    cancelReason: { type: String, default: '' },

    // ── AUDIT TRAIL ──
    actionHistory: { type: [ACTION_HISTORY_SCHEMA], default: [] },
  },
  { timestamps: true }
);

// ── COMPUTED FIELD HELPER ──
leaveSchema.methods.toSafeObject = function () {
  return this.toObject({ virtuals: true });
};

export const Leave = mongoose.model('Leave', leaveSchema);
