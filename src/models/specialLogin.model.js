import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const specialLoginSchema = new mongoose.Schema(
  {
    specialId: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      match: /^IA(HR|GM|VP|DI)\d{3}$/,   // IA + role code + 3 digits
    },
    password: { type: String, required: true, minlength: 6 },
    role: {
      type: String,
      required: true,
      enum: ['HR', 'GM', 'VP', 'Director'],
    },
    name: { type: String, default: '' },   // optional descriptive name
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
    refreshToken: { type: String },
  },
  { timestamps: true }
);

// ---------- pre-save hash ----------
specialLoginSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ---------- compare password ----------
specialLoginSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// ---------- static: generate next specialId for a given role ----------
specialLoginSchema.statics.generateNextId = async function (role) {
  const roleCodeMap = {
    HR: 'HR',
    GM: 'GM',
    VP: 'VP',
    Director: 'DI',
  };
  const code = roleCodeMap[role];
  if (!code) throw new Error(`Invalid role for special ID: ${role}`);

  const prefix = 'IA' + code;

  // Atomically find the latest ID for that role‑prefix and increment
  const last = await this.findOne(
    { specialId: { $regex: `^${prefix}\\d{3}$` } },
    { specialId: 1 }
  )
    .sort({ specialId: -1 })
    .lean();

  if (!last) return `${prefix}001`;

  const lastNum = parseInt(last.specialId.slice(prefix.length), 10);
  const nextNum = lastNum + 1;
  return `${prefix}${String(nextNum).padStart(3, '0')}`;
};

export const SpecialLogin = mongoose.model('SpecialLogin', specialLoginSchema);