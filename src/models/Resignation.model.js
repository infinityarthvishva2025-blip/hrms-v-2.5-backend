import mongoose from 'mongoose';

const timelineSchema = new mongoose.Schema({
  action: { 
    type: String, 
    enum: ['Applied', 'Approve', 'Approved', 'Reject', 'Rejected', 'Put on Hold', 'Send Back', 'Withdraw', 'Withdrawn', 'Resubmitted'], 
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
    type: String 
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

const resignationSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },
    resignationDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    noticePeriodDays: {
      type: Number,
      required: true,
      default: 30, // Fixed to 30 days
    },
    lastWorkingDay: {
      type: Date,
      required: true,
    },
    reason: {
      type: String,
      required: true,
      enum: [
        'Better Opportunity', 
        'Relocation', 
        'Personal Reason', 
        'Higher Studies', 
        'Health Issues', 
        'Others'
      ],
    },
    remarks: {
      type: String,
    },
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', 'On Hold', 'Sent Back', 'Withdrawn'],
      default: 'Pending',
    },
    approvalChain: [{ 
      type: String 
    }],
    currentApprovalLevel: {
      type: Number,
      default: 0,
    },
    currentApproverRole: {
      type: String,
    },
    timeline: [timelineSchema],
  },
  { timestamps: true }
);

export const Resignation = mongoose.model('Resignation', resignationSchema);
