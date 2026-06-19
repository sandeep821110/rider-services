import mongoose from "mongoose";

const OrderSchema = new mongoose.Schema(
  {
    orderId: { type: String, unique: true, index: true },
    orderNumber: { type: String, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    items: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId },
        name: { type: String },
        quantity: { type: Number, default: 1 },
        price: { type: Number, default: 0 },
        size: { type: String },
      },
    ],
    shippingAddress: { type: mongoose.Schema.Types.Mixed, default: {} },
    email: { type: String, default: null },
    totalAmount: { type: Number, default: 0 },
    itemsPrice: { type: Number, default: null },
    shippingPrice: { type: Number, default: 0 },
    couponCode: { type: String, default: null },
    couponDiscount: { type: Number, default: 0 },
    paymentMethod: { type: String, default: "cod" },
    paymentStatus: { type: String, default: "PENDING" },
    paidVia: { type: String, default: null },
    paidAt: { type: Date, default: null },
    deliveryMethod: { type: String, default: null },
    deliverySignature: { type: String, default: null },
    deliveredAt: { type: Date, default: null },
    orderStatus: { type: String, default: "PLACED" },
    assignedRider: { type: mongoose.Schema.Types.ObjectId, ref: "Rider", default: null },
    riderStatus: {
      type: String,
      enum: ["unassigned", "assigned", "picked_up", "out_for_delivery", "delivered"],
      default: "unassigned",
    },
    assignedAt: { type: Date, default: null },
    trackingNumber: { type: String, default: null },
  },
  { timestamps: true }
);

const Order = mongoose.models.Order || mongoose.model("Order", OrderSchema);
export default Order;
