import mongoose from 'mongoose';

const subsectionSchema = new mongoose.Schema(
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
    sectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Section',
      required: true,
    },
    content: {
      type: String, // Optional text content
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },
  },
  { timestamps: true }
);

// Ensure order is unique per section
subsectionSchema.index({ sectionId: 1, order: 1 }, { unique: true });

export const Subsection = mongoose.model('Subsection', subsectionSchema);