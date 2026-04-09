import mongoose from 'mongoose';

const payrollSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    employeeCode: { type: String, required: true },
    employeeName: { type: String },
    
    // ── PERIOD ──
    month: { type: Number, required: true }, // 1-12
    year: { type: Number, required: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    // ── ATTENDANCE SUMMARY ──
    totalDaysInMonth: { type: Number, required: true },
    workingDays: { type: Number, default: 0 },
    presentDays: { type: Number, default: 0 },
    halfDays: { type: Number, default: 0 },
    halfDayDetails: [{ date: Date, reason: String }], // To track specific half days
    absentDays: { type: Number, default: 0 },
    absentDayDetails: [{ date: Date, reason: String }], // To track specific absent dates
    paidLeaves: { type: Number, default: 0 },
    unpaidLeaves: { type: Number, default: 0 },
    holidays: { type: Number, default: 0 },
    weekOffs: { type: Number, default: 0 },
    paidDays: { type: Number, required: true }, // Total days for which salary is paid
    
    // ── SALARY CALCULATIONS ──
    baseSalary: { type: Number, required: true }, // Monthly CTC/Fixed
    grossEarnings: { type: Number, required: true }, // (Base / Total Days) * Paid Days
    
    // ── DEDUCTIONS ──
    professionalTax: { type: Number, default: 0 },
    otherDeductions: { type: Number, default: 0 },
    
    // ── TOTALS ──
    netSalary: { type: Number, required: true }, // Gross - Deductions
    
    // ── STATUS & DOCS ──
    status: {
      type: String,
      enum: ['Draft', 'Processed', 'Paid'],
      default: 'Draft',
    },
    paymentDate: { type: Date },
    salarySlipUrl: { type: String }, // Cloudinary URL for PDF
    remarks: { type: String },
    
    processedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
    }
  },
  { timestamps: true }
);

// ── UNIQUE CONSTRAINT: ONE PAYROLL PER EMPLOYEE PER MONTH/YEAR ──
payrollSchema.index({ employeeId: 1, month: 1, year: 1 }, { unique: true });

export const Payroll = mongoose.model('Payroll', payrollSchema);
