import mongoose from 'mongoose';

const sectionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    videoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Video',
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },
  },
  { timestamps: true }
);

// Ensure order is unique per video
sectionSchema.index({ videoId: 1, order: 1 }, { unique: true });

export const Section = mongoose.model('Section', sectionSchema);