import mongoose from 'mongoose';

const complaintTimelineSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['Submitted', 'Acknowledged', 'In Review', 'Resolved', 'Rejected', 'Commented'],
    required: true
  },
  actionBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  role: {
    type: String,
    required: true
  },
  comments: {
    type: String,
    default: ''
  },
  previousStatus: {
    type: String
  },
  updatedStatus: {
    type: String
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const complaintSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true
    },
    title: {
      type: String,
      required: [true, 'Complaint title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters']
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      enum: [
        'Work Environment',
        'Harassment',
        'Discrimination',
        'Management',
        'Policy Violation',
        'Facilities',
        'Other'
      ]
    },
    priority: {
      type: String,
      enum: ['Low', 'Medium', 'High'],
      default: 'Medium'
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters']
    },
    status: {
      type: String,
      enum: ['Pending', 'Acknowledged', 'In Review', 'Resolved', 'Rejected'],
      default: 'Pending'
    },
    directorComments: {
      type: String,
      default: ''
    },
    timeline: [complaintTimelineSchema]
  },
  { timestamps: true }
);

// Index for efficient querying
complaintSchema.index({ employee: 1, status: 1 });
complaintSchema.index({ status: 1, createdAt: -1 });
complaintSchema.index({ priority: 1 });

export const Complaint = mongoose.model('Complaint', complaintSchema);