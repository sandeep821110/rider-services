import mongoose from "mongoose";

const RiderSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
    },
    dateOfBirth: {
      type: Date,
      default: null,
    },
    numberPlate: {
      type: String,
      trim: true,
      default: null,
    },
    vehicleType: {
      type: String,
      enum: ["bike", "scooter", "car", "other"],
      default: "bike",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "suspended", "rejected"],
      default: "pending",
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    depositPaid: {
      type: Boolean,
      default: false,
    },
    depositAmount: {
      type: Number,
      default: 20,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    totalDeliveries: {
      type: Number,
      default: 0,
    },
    currentLat: { type: Number, default: null },
    currentLng: { type: Number, default: null },
    lastLocationUpdate: { type: Date, default: null },
  },
  { timestamps: true }
);

const Rider = mongoose.models.Rider || mongoose.model("Rider", RiderSchema);
export default Rider;
