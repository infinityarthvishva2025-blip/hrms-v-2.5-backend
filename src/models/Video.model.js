import mongoose from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";

const videoSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    cloudinaryUrl: {
      type: String,
      required: true,
    },
    publicId: {
      type: String,
      required: true,
    },
    duration: {
      type: Number, // in seconds
    },
    thumbnail: {
      type: String,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// ✅ ADD THIS LINE (THIS FIXES YOUR ERROR)
videoSchema.plugin(mongoosePaginate);

// ✅ OPTIONAL: Clean JSON response
videoSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.__v;
    return ret;
  },
});

export const Video = mongoose.model("Video", videoSchema);