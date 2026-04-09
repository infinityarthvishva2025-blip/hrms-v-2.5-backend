import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['General', 'Urgent', 'Event', 'Policy Update', 'Other'],
      default: 'General',
    },
    priority: {
      type: String,
      enum: ['Normal', 'Important', 'Urgent'],
      default: 'Normal',
    },
    
    // ── TARGETING ──
    targetType: {
      type: String,
      enum: ['All', 'Department', 'Role', 'Employee'],
      required: true,
      default: 'All',
    },
    targetDepartments: {
      type: [String],
      default: [],
    },
    targetRoles: {
      type: [String],
      default: [],
    },
    targetEmployees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
      },
    ],

    // ── LIFECYCLE ──
    expiresAt: {
      type: Date,
      default: null, // null means it never expires naturally
    },
    isActive: {
      type: Boolean,
      default: true,
    },

    // ── TRACKING & METADATA ──
    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },
  },
  { timestamps: true }
);

// Indexes for faster querying
announcementSchema.index({ targetType: 1 });
announcementSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index if expiresAt is set
announcementSchema.index({ isActive: 1 });

export const Announcement = mongoose.model('Announcement', announcementSchema);
