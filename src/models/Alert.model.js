import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema(
  {
    active: {
      type: Boolean,
      default: true,          // an alert is active by default when created
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      default: 'info',
    },
    startDate: {
      type: Date,
      default: Date.now,      // if not provided, alert starts immediately
    },
    endDate: {
      type: Date,
      default: null,          // null means indefinite
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
  },
  { timestamps: true }
);

// Compound index to quickly find currently active alerts
alertSchema.index({ active: 1, startDate: 1, endDate: 1 });

export const Alert = mongoose.model('Alert', alertSchema);