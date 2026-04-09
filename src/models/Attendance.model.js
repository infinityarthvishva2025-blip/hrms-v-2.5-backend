import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    employeeCode: { type: String, required: true, uppercase: true, index: true },
    employeeName: { type: String },

    // ── DATE (normalized to midnight) ──
    date: { type: Date, required: true, index: true },

    // ── TIMES ──
    inTime: { type: Date },   // Full datetime for accurate calculation
    outTime: { type: Date },

    // ── COMPUTED ──
    totalHours: { type: Number },   // in decimal (e.g., 8.5)
    totalMinutes: { type: Number },

    // ── STATUS: P, A, WO, L, Coff, AUTO ──
    status: {
      type: String,
      enum: ['P', 'A', 'WO', 'L', 'Coff', 'AUTO', 'H'],
      default: 'P',
    },

    // ── LATE INFO ──
    isLate: { type: Boolean, default: false },
    lateMinutes: { type: Number, default: 0 },

    // ── GEO ATTENDANCE ──
    isGeoAttendance: { type: Boolean, default: false },
    checkInLatitude: { type: Number },
    checkInLongitude: { type: Number },
    checkOutLatitude: { type: Number },
    checkOutLongitude: { type: Number },

    // ── CORRECTION ──
    correctionRequested: { type: Boolean, default: false },
    correctionStatus: {
      type: String,
      enum: [
        'None', 
        'Pending_HR', 
        'Pending_GM', 
        'Pending_VP', 
        'Pending_Director', 
        'Approved', 
        'Rejected'
      ],
      default: 'None',
    },
    correctionReason: { type: String },
    correctionProofUrl: { type: String }, // Cloudinary URL
    correctionRequestedOn: { type: Date },
    
    // Requested Values
    requestedInTime: { type: Date },
    requestedOutTime: { type: Date },

    // Audit
    correctionHistory: [{
      action: { type: String, enum: ['Requested', 'Approved', 'Rejected'] },
      byRole: { type: String },
      byEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
      remark: { type: String },
      timestamp: { type: Date, default: Date.now }
    }],

    // ── COMP OFF ──
    isCompOffCredited: { type: Boolean, default: false },

    // ── CHECKOUT REPORTING ──
    todayWork: { type: String },
    pendingWork: { type: String },
    issuesFaced: { type: String },
    
    // ── REPORT SHARING ──
    reportParticipants: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    }],
    reportReadBy: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    }],
  },
  { timestamps: true }
);

// ── UNIQUE CONSTRAINT: ONE RECORD PER EMPLOYEE PER DAY ──
attendanceSchema.index({ employeeCode: 1, date: 1 }, { unique: true });

// ── VIRTUAL: formatted in/out times ──
attendanceSchema.virtual('inTimeFormatted').get(function () {
  if (!this.inTime) return null;
  return this.inTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
});

attendanceSchema.virtual('outTimeFormatted').get(function () {
  if (!this.outTime) return null;
  return this.outTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
});

attendanceSchema.set('toJSON', { virtuals: true });
attendanceSchema.set('toObject', { virtuals: true });

export const Attendance = mongoose.model('Attendance', attendanceSchema);
