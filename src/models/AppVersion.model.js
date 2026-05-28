import mongoose from 'mongoose';

const appVersionSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      required: true,
      enum: ['android', 'ios'],
      lowercase: true,
    },
    versionCode: {
      type: Number,
      required: true,
      min: 1,
    },
    versionName: {
      type: String,
      required: true,
      trim: true,             // e.g. "2.1.0"
    },
    forceUpdate: {
      type: Boolean,
      default: false,         // true = user MUST update before continuing
    },
    updateUrl: {
      type: String,
      required: true,
      trim: true,             // store link
    },
    releaseNotes: {
      type: String,
      trim: true,
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

// Ensure only one version entry per platform and versionCode
appVersionSchema.index({ platform: 1, versionCode: 1 }, { unique: true });

export const AppVersion = mongoose.model('AppVersion', appVersionSchema);