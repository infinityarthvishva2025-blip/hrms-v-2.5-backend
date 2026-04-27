import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';

const employeeSchema = new mongoose.Schema(
  {
    // ── EMPLOYEE CODE ──
    employeeCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      match: /^IA\d{5}$/,
    },

    // ── ACCOUNT ──
    password: { type: String, required: true, minlength: 6 },
    role: {
      type: String,
      required: true,
      enum: ['SuperUser', 'HR', 'Manager', 'Director', 'VP', 'GM', 'Employee', 'Intern' , "fresher"],
      default: 'Employee',
    },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
    deactivateReason: { type: String },

    // ── BASIC DETAILS ──
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    mobileNumber: { type: String, required: true, trim: true },
    alternateMobileNumber: { type: String, trim: true },
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    bloodGroup: { type: String, enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
    dateOfBirth: { type: Date },
    maritalStatus: { type: String, enum: ['Single', 'Married', 'Divorced', 'Widowed'] },
    profileImageUrl: { type: String }, // Cloudinary URL
    faceDescriptor: { type: [Number] }, // For storing face-api.js array descriptor

    // ── PERSONAL DETAILS ──
    fatherName: { type: String, trim: true },
    motherName: { type: String, trim: true },
    currentAddress: { type: String },
    permanentAddress: { type: String },
    district: { type: String },
    state: { type: String },
    pincode: { type: String },

    // ── JOB DETAILS ──
    joiningDate: { type: Date },
    department: { type: String, trim: true },
    position: { type: String, trim: true },
    salary: { type: Number },
    reportingManager: { type: String },
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },

    // ── EXPERIENCE ──
    experienceType: { type: String, enum: ['Fresher', 'Experienced' ] },
    totalExperienceYears: { type: Number },
    lastCompanyName: { type: String },
    experienceCertificateUrl: { type: String }, // Cloudinary URL

    // ── EDUCATION ──
    hscPercent: { type: Number },
    graduationCourse: { type: String },
    graduationPercent: { type: Number },
    postGraduationCourse: { type: String },
    postGraduationPercent: { type: Number },

    // ── DOCS (Cloudinary URLs) ──
    aadhaarNumber: { type: String },
    panNumber: { type: String },
    aadhaarFileUrl: { type: String },
    panFileUrl: { type: String },
    passbookFileUrl: { type: String },
    tenthMarksheetUrl: { type: String },
    twelfthMarksheetUrl: { type: String },
    graduationMarksheetUrl: { type: String },
    postGraduationMarksheetUrl: { type: String },
    medicalDocumentUrl: { type: String },

    // ── BANK DETAILS ──
    accountHolderName: { type: String },
    bankName: { type: String },
    accountNumber: { type: String },
    ifsc: { type: String },
    branch: { type: String },
    bankVerified: { type: Boolean, default: false },
    bankVerifiedDate: { type: Date },

    // ── VERIFICATION ──
    aadhaarVerified: { type: Boolean, default: false },
    panVerified: { type: Boolean, default: false },
    aadhaarVerifiedDate: { type: Date },
    panVerifiedDate: { type: Date },

    // ── EMERGENCY CONTACT ──
    emergencyContactName: { type: String },
    emergencyContactRelationship: { type: String },
    emergencyContactMobile: { type: String },
    emergencyContactAddress: { type: String },

    // ── HEALTH ──
    hasDisease: { type: String, enum: ['Yes', 'No'], default: 'No' },
    diseaseName: { type: String },
    diseaseType: { type: String },
    diseaseSince: { type: String },
    medicinesRequired: { type: String },
    doctorName: { type: String },
    doctorContact: { type: String },

    // ── LEAVE BALANCES ──
    compOffBalance: { type: Number, default: 0 },
    paidLeaveBalance: { type: Number, default: 0 },
    lastWorkingDate: { type: Date },

    // ── REFRESH TOKENS ──
    refreshToken: { type: String },

    // ── NOTIFICATIONS ──
    fcmToken: { type: String },
  },
  { timestamps: true }
);

// ── HASH PASSWORD BEFORE SAVE ──
employeeSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ── COMPARE PASSWORD ──
employeeSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// ── GENERATE NEXT EMPLOYEE CODE (STATIC) ──
employeeSchema.statics.generateNextCode = async function () {
  const prefix = config.company.prefix;
  const last = await this.findOne({}, { employeeCode: 1 }).sort({ employeeCode: -1 });
  if (!last) return `${prefix}00001`;
  const num = parseInt(last.employeeCode.substring(prefix.length)) + 1;
  return `${prefix}${String(num).padStart(5, '0')}`;
};

// ── HIDE SENSITIVE FIELDS ──
employeeSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshToken;
  return obj;
};

export const Employee = mongoose.model('Employee', employeeSchema);
