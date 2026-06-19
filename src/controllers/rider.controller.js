import crypto from "crypto";
import jwt from "jsonwebtoken";
import Razorpay from "razorpay";
import Rider from "../models/Rider.js";
import Order from "../models/Order.js";
import logger from "../utils/logger.js";
import { generateOTP, verifyOTP, generateDeliveryOTP, verifyDeliveryOTP } from "../services/otp.service.js";
import { sendOTPEmail, sendDeliveryOTPEmail, sendDeliveryConfirmedEmail } from "../services/email.service.js";
import config from "../config/config.js";

const RIDER_TRACKING_STATUS_MAP = {
  assigned: "shipped",
  picked_up: "shipped",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
};

const notifyTrackingService = async (orderId, riderStatus, location) => {
  const trackingStatus = RIDER_TRACKING_STATUS_MAP[riderStatus];
  if (!trackingStatus) return null;

  try {
    const url = `${config.trackingServiceURL}/api/tracking/internal/order-status/${orderId}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: trackingStatus, location, description: `Rider updated: ${riderStatus}` }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn(`[Tracking] Status update failed for order ${orderId}: ${body.message || res.status}`);
      return null;
    }
    return body.data || null;
  } catch (err) {
    console.warn(`[Tracking] Cannot reach tracking service for order ${orderId}: ${err.message}`);
    return null;
  }
};

const fetchTrackingByOrderId = async (orderId) => {
  if (!orderId) return null;
  try {
    const url = `${config.trackingServiceURL}/api/tracking/internal/by-order-id/${orderId}`;
    const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
    if (!res.ok) return null;
    const body = await res.json();
    return body.data || null;
  } catch {
    return null;
  }
};

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const generateToken = (rider) => {
  return jwt.sign(
    { id: rider._id, email: rider.email, role: "rider" },
    config.jwtSecret,
    { expiresIn: config.jwtExpiry }
  );
};

const generateTempToken = (email) => {
  return jwt.sign(
    { email, purpose: "rider_registration" },
    config.jwtSecret,
    { expiresIn: "15m" }
  );
};

const extractToken = (req) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) return auth.split(" ")[1];
  return null;
};

export const authenticateRider = (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const decoded = jwt.verify(token, config.jwtSecret);
    if (decoded.purpose) {
      return res.status(401).json({ success: false, message: "Complete your profile first" });
    }
    req.rider = { id: decoded.id, email: decoded.email };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

export const riderSendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const otp = await generateOTP(normalizedEmail);

    const rider = await Rider.findOne({ email: normalizedEmail });
    const riderName = rider?.name || "Rider";

    const emailSent = await sendOTPEmail({ email: normalizedEmail, name: riderName, otp });

    if (process.env.NODE_ENV !== "production") {
      return res.json({
        success: true,
        message: emailSent ? "OTP sent to email" : "OTP generated for testing (email unavailable)",
        otp_for_testing: otp,
      });
    }

    if (!emailSent) {
      return res.status(500).json({ success: false, message: "Failed to send OTP email. Please try again." });
    }

    res.json({ success: true, message: "OTP sent to email" });
  } catch (err) {
    logger.error("Rider send OTP error:", err);
    res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
};

export const riderVerifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and OTP are required" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const isValid = await verifyOTP(normalizedEmail, otp);
    if (!isValid) {
      return res.status(401).json({ success: false, message: "Invalid or expired OTP" });
    }

    const rider = await Rider.findOne({ email: normalizedEmail });

    if (rider) {
      if (!rider.isActive) {
        return res.status(403).json({ success: false, message: "Account is deactivated. Contact admin." });
      }

      const token = generateToken(rider);

      return res.json({
        success: true,
        exists: true,
        message: "Login successful",
        token,
        rider: {
          id: rider._id,
          name: rider.name,
          email: rider.email,
          phone: rider.phone,
          dateOfBirth: rider.dateOfBirth,
          numberPlate: rider.numberPlate,
          status: rider.status,
          isApproved: rider.isApproved,
          depositPaid: rider.depositPaid,
          vehicleType: rider.vehicleType,
          totalDeliveries: rider.totalDeliveries,
        },
      });
    }

    const tempToken = generateTempToken(normalizedEmail);

    res.json({
      success: true,
      exists: false,
      message: "Email verified. Complete your profile.",
      tempToken,
    });
  } catch (err) {
    logger.error("Rider verify OTP error:", err);
    res.status(500).json({ success: false, message: "Verification failed" });
  }
};

export const riderCompleteProfile = async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Verification required" });
    }

    const tempToken = auth.split(" ")[1];
    let decoded;
    try {
      decoded = jwt.verify(tempToken, config.jwtSecret);
    } catch {
      return res.status(401).json({ success: false, message: "Verification expired. Request OTP again." });
    }

    if (decoded.purpose !== "rider_registration") {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    const { name, phone, dateOfBirth, vehicleType, numberPlate } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }

    if (!phone || !phone.trim()) {
      return res.status(400).json({ success: false, message: "Phone number is required" });
    }

    const normalizedEmail = decoded.email;

    const existing = await Rider.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ success: false, message: "Rider already registered" });
    }

    const rider = await Rider.create({
      name: name.trim(),
      email: normalizedEmail,
      phone: phone.trim(),
      dateOfBirth: dateOfBirth || null,
      numberPlate: numberPlate || null,
      vehicleType: vehicleType || "bike",
      status: "pending",
      isApproved: false,
    });

    logger.info(`New rider registered: ${rider.email} (pending approval)`);

    const token = generateToken(rider);

    res.status(201).json({
      success: true,
      message: "Registration successful. Awaiting admin approval.",
      token,
      rider: {
        id: rider._id,
        name: rider.name,
        email: rider.email,
        phone: rider.phone,
        dateOfBirth: rider.dateOfBirth,
        numberPlate: rider.numberPlate,
        status: rider.status,
        isApproved: rider.isApproved,
        depositPaid: rider.depositPaid,
        vehicleType: rider.vehicleType,
        totalDeliveries: rider.totalDeliveries,
      },
    });
  } catch (err) {
    logger.error("Rider complete profile error:", err);
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "Email already registered" });
    }
    res.status(500).json({ success: false, message: "Registration failed" });
  }
};

export const riderProfile = async (req, res) => {
  try {
    const rider = await Rider.findById(req.rider.id);
    if (!rider) {
      return res.status(404).json({ success: false, message: "Rider not found" });
    }
    res.json({ success: true, rider });
  } catch (err) {
    logger.error("Rider profile error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch profile" });
  }
};

export const riderPayDeposit = async (req, res) => {
  try {
    const riderId = req.rider.id;
    const { amount } = req.body;

    const depositAmount = amount || 20;
    if (depositAmount < 20) {
      return res.status(400).json({ success: false, message: "Minimum deposit is ₹20" });
    }

    const rider = await Rider.findByIdAndUpdate(
      riderId,
      { depositPaid: true, depositAmount },
      { new: true }
    );

    res.json({
      success: true,
      message: "Deposit paid successfully",
      rider: {
        id: rider._id,
        name: rider.name,
        depositPaid: rider.depositPaid,
        depositAmount: rider.depositAmount,
      },
    });
  } catch (err) {
    logger.error("Rider pay deposit error:", err);
    res.status(500).json({ success: false, message: "Failed to process deposit" });
  }
};

export const adminGetRiders = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const riders = await Rider.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, riders });
  } catch (err) {
    logger.error("Admin get riders error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch riders" });
  }
};

export const adminApproveRider = async (req, res) => {
  try {
    const { riderId } = req.params;
    const rider = await Rider.findByIdAndUpdate(
      riderId,
      { status: "approved", isApproved: true, depositPaid: true, depositAmount: 0 },
      { new: true }
    );

    if (!rider) {
      return res.status(404).json({ success: false, message: "Rider not found" });
    }

    logger.info(`Rider approved: ${rider.email}`);
    res.json({ success: true, message: "Rider approved successfully", rider });
  } catch (err) {
    logger.error("Admin approve rider error:", err);
    res.status(500).json({ success: false, message: "Failed to approve rider" });
  }
};

export const adminRejectRider = async (req, res) => {
  try {
    const { riderId } = req.params;
    const rider = await Rider.findByIdAndUpdate(
      riderId,
      { status: "rejected", isApproved: false },
      { new: true }
    );

    if (!rider) {
      return res.status(404).json({ success: false, message: "Rider not found" });
    }

    logger.info(`Rider rejected: ${rider.email}`);
    res.json({ success: true, message: "Rider rejected", rider });
  } catch (err) {
    logger.error("Admin reject rider error:", err);
    res.status(500).json({ success: false, message: "Failed to reject rider" });
  }
};

export const adminSuspendRider = async (req, res) => {
  try {
    const { riderId } = req.params;
    const rider = await Rider.findByIdAndUpdate(
      riderId,
      { status: "suspended", isApproved: false },
      { new: true }
    );

    if (!rider) {
      return res.status(404).json({ success: false, message: "Rider not found" });
    }

    res.json({ success: true, message: "Rider suspended", rider });
  } catch (err) {
    logger.error("Admin suspend rider error:", err);
    res.status(500).json({ success: false, message: "Failed to suspend rider" });
  }
};

export const riderGetMyOrders = async (req, res) => {
  try {
    const riderId = req.rider.id;
    const { status } = req.query;

    const filter = { assignedRider: riderId };
    if (status) filter.riderStatus = status;

    const orders = await Order.find(filter)
      .populate("assignedRider", "name email phone")
      .sort({ assignedAt: -1 });

    const formatted = await Promise.all(orders.map(async (o) => {
      if (!o.trackingNumber) {
        const td = await fetchTrackingByOrderId(o._id);
        if (td?.trackingNumber) {
          o.trackingNumber = td.trackingNumber;
          await o.save();
        }
      }
      return {
        _id: o._id,
        orderId: o.orderId,
        orderNumber: o.orderNumber,
        trackingNumber: o.trackingNumber,
        items: o.items,
        shippingAddress: o.shippingAddress,
        totalAmount: o.totalAmount,
        paymentMethod: o.paymentMethod || "cod",
        paymentStatus: o.paymentStatus || "PENDING",
        paidVia: o.paidVia,
        paidAt: o.paidAt,
        orderStatus: o.orderStatus,
        riderStatus: o.riderStatus,
        deliveryMethod: o.deliveryMethod,
        deliverySignature: o.deliverySignature,
        deliveredAt: o.deliveredAt,
        assignedAt: o.assignedAt,
        createdAt: o.createdAt,
      };
    }));

    res.json({ success: true, orders: formatted, count: formatted.length });
  } catch (err) {
    logger.error("Rider get my orders error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch orders" });
  }
};

export const riderGetOrderDetail = async (req, res) => {
  try {
    const riderId = req.rider.id;
    const { orderId } = req.params;

    const order = await Order.findOne({ _id: orderId, assignedRider: riderId })
      .populate("assignedRider", "name email phone");

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found or not assigned to you" });
    }

    if (!order.trackingNumber) {
      const td = await fetchTrackingByOrderId(order._id);
      if (td?.trackingNumber) {
        order.trackingNumber = td.trackingNumber;
        await order.save();
      }
    }

    res.json({
      success: true,
      order: {
        _id: order._id,
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        trackingNumber: order.trackingNumber,
        items: order.items,
        shippingAddress: order.shippingAddress,
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod || "cod",
        paymentStatus: order.paymentStatus || "PENDING",
        paidVia: order.paidVia,
        paidAt: order.paidAt,
        orderStatus: order.orderStatus,
        riderStatus: order.riderStatus,
        deliveryMethod: order.deliveryMethod,
        deliverySignature: order.deliverySignature,
        deliveredAt: order.deliveredAt,
        assignedAt: order.assignedAt,
        createdAt: order.createdAt,
        userId: order.userId,
      },
    });
  } catch (err) {
    logger.error("Rider get order detail error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch order details" });
  }
};

export const riderUpdateDeliveryStatus = async (req, res) => {
  try {
    const riderId = req.rider.id;
    const { orderId } = req.params;
    const { status } = req.body;

    const validStatuses = ["picked_up", "out_for_delivery", "delivered"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const order = await Order.findOne({ _id: orderId, assignedRider: riderId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found or not assigned to you" });
    }

    const transitions = {
      assigned: ["picked_up"],
      picked_up: ["out_for_delivery", "delivered"],
      out_for_delivery: ["delivered"],
    };

    const allowed = transitions[order.riderStatus];
    if (!allowed || !allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot transition from ${order.riderStatus} to ${status}`,
      });
    }

    order.riderStatus = status;

    if (status === "delivered") {
      order.orderStatus = "DELIVERED";
      await Rider.findByIdAndUpdate(riderId, { $inc: { totalDeliveries: 1 } });
    }

    await order.save();

    notifyTrackingService(order._id, status, order.shippingAddress?.city);

    res.json({
      success: true,
      message: `Order status updated to ${status}`,
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        riderStatus: order.riderStatus,
        orderStatus: order.orderStatus,
      },
    });
  } catch (err) {
    logger.error("Rider update delivery status error:", err);
    res.status(500).json({ success: false, message: "Failed to update status" });
  }
};

export const adminAssignOrder = async (req, res) => {
  try {
    const { orderId, riderId } = req.body;

    if (!orderId || !riderId) {
      return res.status(400).json({ success: false, message: "Order ID and Rider ID are required" });
    }

    const rider = await Rider.findById(riderId);
    if (!rider) {
      return res.status(404).json({ success: false, message: "Rider not found" });
    }

    if (!rider.isApproved) {
      return res.status(400).json({ success: false, message: "Rider is not approved" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (order.riderStatus !== "unassigned") {
      return res.status(400).json({ success: false, message: "Order already assigned to a rider" });
    }

    order.assignedRider = riderId;
    order.riderStatus = "assigned";
    order.assignedAt = new Date();
    await order.save();

    const trackingData = await fetchTrackingByOrderId(order._id);
    if (trackingData?.trackingNumber) {
      order.trackingNumber = trackingData.trackingNumber;
      await order.save();
    }

    logger.info(`Order ${order.orderNumber} assigned to rider ${rider.name}`);

    const populatedOrder = await Order.findById(order._id)
      .populate("assignedRider", "name email phone vehicleType currentLat currentLng lastLocationUpdate totalDeliveries");

    res.json({
      success: true,
      message: "Order assigned to rider successfully",
      order: populatedOrder,
    });
  } catch (err) {
    logger.error("Admin assign order error:", err);
    res.status(500).json({ success: false, message: "Failed to assign order" });
  }
};

export const riderRequestDeliveryOtp = async (req, res) => {
  try {
    const riderId = req.rider.id;
    const { orderId } = req.params;

    const order = await Order.findOne({ _id: orderId, assignedRider: riderId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found or not assigned to you" });
    }

    if (order.riderStatus !== "out_for_delivery") {
      return res.status(400).json({ success: false, message: "Order must be out for delivery to request delivery OTP" });
    }

    const customerEmail = order.shippingAddress?.email;
    if (!customerEmail) {
      return res.status(400).json({ success: false, message: "Customer email not found on order" });
    }

    const otp = await generateDeliveryOTP(orderId);

    const emailSent = await sendDeliveryOTPEmail({
      email: customerEmail,
      otp,
      customerName: order.shippingAddress?.fullName || "Customer",
    });

    if (process.env.NODE_ENV !== "production") {
      return res.json({
        success: true,
        message: emailSent ? "Delivery OTP sent to customer" : "Delivery OTP generated for testing",
        otp_for_testing: otp,
      });
    }

    if (!emailSent) {
      return res.status(500).json({ success: false, message: "Failed to send delivery OTP email" });
    }

    res.json({ success: true, message: "Delivery OTP sent to customer" });
  } catch (err) {
    logger.error("Request delivery OTP error:", err);
    res.status(500).json({ success: false, message: "Failed to send delivery OTP" });
  }
};

export const riderVerifyDeliveryOtp = async (req, res) => {
  try {
    const riderId = req.rider.id;
    const { orderId } = req.params;
    const { otp } = req.body;

    if (!otp) {
      return res.status(400).json({ success: false, message: "OTP is required" });
    }

    const order = await Order.findOne({ _id: orderId, assignedRider: riderId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found or not assigned to you" });
    }

    if (order.riderStatus !== "out_for_delivery") {
      return res.status(400).json({ success: false, message: "Order must be out for delivery to verify delivery OTP" });
    }

    const isValid = await verifyDeliveryOTP(orderId, otp);
    if (!isValid) {
      return res.status(401).json({ success: false, message: "Invalid or expired OTP" });
    }

    order.riderStatus = "delivered";
    order.orderStatus = "DELIVERED";
    order.deliveryMethod = "otp";
    order.deliveredAt = new Date();
    await order.save();

    notifyTrackingService(order._id, "delivered", order.shippingAddress?.city);

    await Rider.findByIdAndUpdate(riderId, { $inc: { totalDeliveries: 1 } });

    sendDeliveryConfirmedEmail({
      email: order.shippingAddress?.email,
      customerName: order.shippingAddress?.fullName,
      orderNumber: order.orderNumber,
      orderId: order._id,
      totalAmount: order.totalAmount,
      items: order.items,
      deliveredAt: order.deliveredAt,
    });

    res.json({
      success: true,
      message: "Delivery confirmed via OTP",
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        riderStatus: order.riderStatus,
        orderStatus: order.orderStatus,
        deliveryMethod: order.deliveryMethod,
        deliveredAt: order.deliveredAt,
      },
    });
  } catch (err) {
    logger.error("Verify delivery OTP error:", err);
    res.status(500).json({ success: false, message: "Failed to verify delivery OTP" });
  }
};

export const riderDeliverWithSignature = async (req, res) => {
  try {
    const riderId = req.rider.id;
    const { orderId } = req.params;
    const { signature } = req.body;

    if (!signature) {
      return res.status(400).json({ success: false, message: "Signature is required" });
    }

    const order = await Order.findOne({ _id: orderId, assignedRider: riderId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found or not assigned to you" });
    }

    if (order.riderStatus !== "out_for_delivery") {
      return res.status(400).json({ success: false, message: "Order must be out for delivery to confirm delivery" });
    }

    order.riderStatus = "delivered";
    order.orderStatus = "DELIVERED";
    order.deliveryMethod = "signature";
    order.deliverySignature = signature;
    order.deliveredAt = new Date();
    await order.save();

    notifyTrackingService(order._id, "delivered", order.shippingAddress?.city);

    await Rider.findByIdAndUpdate(riderId, { $inc: { totalDeliveries: 1 } });

    sendDeliveryConfirmedEmail({
      email: order.shippingAddress?.email,
      customerName: order.shippingAddress?.fullName,
      orderNumber: order.orderNumber,
      orderId: order._id,
      totalAmount: order.totalAmount,
      items: order.items,
      deliveredAt: order.deliveredAt,
    });

    res.json({
      success: true,
      message: "Delivery confirmed with signature",
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        riderStatus: order.riderStatus,
        orderStatus: order.orderStatus,
        deliveryMethod: order.deliveryMethod,
        deliveredAt: order.deliveredAt,
      },
    });
  } catch (err) {
    logger.error("Deliver with signature error:", err);
    res.status(500).json({ success: false, message: "Failed to confirm delivery" });
  }
};

export const riderGeneratePaymentLink = async (req, res) => {
  try {
    const riderId = req.rider.id;
    const { orderId } = req.params;

    const order = await Order.findOne({ _id: orderId, assignedRider: riderId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found or not assigned to you" });
    }

    if ((order.paymentMethod || "cod").toLowerCase() !== "cod") {
      return res.status(400).json({ success: false, message: "Payment link is only for COD orders" });
    }

    if (order.paymentStatus === "PAID") {
      return res.status(400).json({ success: false, message: "Payment already collected" });
    }

    const amountInPaise = Math.round((order.totalAmount || 0) * 100);
    if (amountInPaise <= 0) {
      return res.status(400).json({ success: false, message: "Invalid order amount" });
    }

    const customerName = order.shippingAddress?.fullName || "Customer";
    const customerEmail = order.shippingAddress?.email || "";
    const customerPhone = order.shippingAddress?.phoneNumber || order.shippingAddress?.phone || "";

    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: order._id.toString(),
      notes: {
        order_id: order._id.toString(),
        order_number: order.orderNumber || "",
        rider_id: riderId,
      },
    });

    logger.info(`Razorpay order created for order ${order.orderNumber}: ${razorpayOrder.id}`);

    res.json({
      success: true,
      message: "Payment initiated",
      razorpayOrderId: razorpayOrder.id,
      amount: amountInPaise,
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID,
      customerName,
      customerEmail,
      customerPhone,
    });
  } catch (err) {
    logger.error("Generate payment error:", err);
    res.status(500).json({ success: false, message: "Failed to initiate payment" });
  }
};

export const riderVerifyPayment = async (req, res) => {
  try {
    const riderId = req.rider.id;
    const { orderId } = req.params;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: "Missing payment verification details" });
    }

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Payment verification failed. Invalid signature." });
    }

    const order = await Order.findOne({ _id: orderId, assignedRider: riderId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found or not assigned to you" });
    }

    order.paymentStatus = "PAID";
    order.paidVia = "online";
    order.paidAt = new Date();
    await order.save();

    logger.info(`Payment verified for order ${order.orderNumber}: Razorpay payment ${razorpay_payment_id}`);

    res.json({
      success: true,
      message: "Payment verified successfully",
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
      },
    });
  } catch (err) {
    logger.error("Verify payment error:", err);
    res.status(500).json({ success: false, message: "Failed to verify payment" });
  }
};

export const riderCollectPayment = async (req, res) => {
  try {
    const riderId = req.rider.id;
    const { orderId } = req.params;
    const { paymentMethod } = req.body;

    if (!paymentMethod || paymentMethod !== "cash") {
      return res.status(400).json({ success: false, message: "Payment method must be 'cash'" });
    }

    const order = await Order.findOne({ _id: orderId, assignedRider: riderId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found or not assigned to you" });
    }

    if ((order.paymentMethod || "cod").toLowerCase() !== "cod") {
      return res.status(400).json({ success: false, message: "Payment collection is only available for COD orders" });
    }

    if (order.paymentStatus === "PAID") {
      return res.status(400).json({ success: false, message: "Payment already collected for this order" });
    }

    if (order.riderStatus !== "out_for_delivery") {
      return res.status(400).json({ success: false, message: "Order must be out for delivery to collect payment" });
    }

    order.paymentStatus = "PAID";
    order.paidVia = paymentMethod;
    order.paidAt = new Date();
    await order.save();

    logger.info(`Payment collected for order ${order.orderNumber}: ${paymentMethod} by rider ${riderId}`);

    res.json({
      success: true,
      message: `Payment collected via ${paymentMethod}`,
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
      },
    });
  } catch (err) {
    logger.error("Collect payment error:", err);
    res.status(500).json({ success: false, message: "Failed to collect payment" });
  }
};

export const riderUpdateLocation = async (req, res) => {
  try {
    const riderId = req.rider.id;
    const { latitude, longitude } = req.body;

    if (latitude == null || longitude == null) {
      return res.status(400).json({ success: false, message: "Latitude and longitude are required" });
    }

    await Rider.findByIdAndUpdate(riderId, {
      currentLat: latitude,
      currentLng: longitude,
      lastLocationUpdate: new Date(),
    });

    res.json({ success: true, message: "Location updated" });
  } catch (err) {
    logger.error("Rider update location error:", err);
    res.status(500).json({ success: false, message: "Failed to update location" });
  }
};
