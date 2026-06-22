import express from "express";
import {
  riderSendOTP,
  riderVerifyOTP,
  riderCompleteProfile,
  riderProfile,
  riderGetMyOrders,
  riderGetOrderDetail,
  riderUpdateDeliveryStatus,
  riderUpdateLocation,
  adminGetRiders,
  adminApproveRider,
  adminRejectRider,
  adminSuspendRider,
  adminAssignOrder,
  authenticateRider,
  riderRequestDeliveryOtp,
  riderVerifyDeliveryOtp,
  riderDeliverWithSignature,
  riderCollectPayment,
  riderGeneratePaymentLink,
  riderVerifyPayment,
  riderCancelDelivery,
} from "../controllers/rider.controller.js";
import { authenticate, requirePermission } from "../middleware/auth.js";

const router = express.Router();

// Public routes
router.post("/send-otp", riderSendOTP);
router.post("/verify-otp", riderVerifyOTP);
router.post("/complete-profile", riderCompleteProfile);

// Rider protected routes
router.get("/profile", authenticateRider, riderProfile);
router.get("/my-orders", authenticateRider, riderGetMyOrders);
router.get("/my-orders/:orderId", authenticateRider, riderGetOrderDetail);
router.patch("/my-orders/:orderId/status", authenticateRider, riderUpdateDeliveryStatus);
router.post("/my-orders/:orderId/request-delivery-otp", authenticateRider, riderRequestDeliveryOtp);
router.post("/my-orders/:orderId/verify-delivery-otp", authenticateRider, riderVerifyDeliveryOtp);
router.post("/my-orders/:orderId/deliver-with-signature", authenticateRider, riderDeliverWithSignature);
router.post("/my-orders/:orderId/collect-payment", authenticateRider, riderCollectPayment);
router.post("/my-orders/:orderId/generate-payment-link", authenticateRider, riderGeneratePaymentLink);
router.post("/my-orders/:orderId/verify-payment", authenticateRider, riderVerifyPayment);
router.post("/update-location", authenticateRider, riderUpdateLocation);
router.post("/my-orders/:orderId/cancel", authenticateRider, riderCancelDelivery);

// Admin routes
router.get("/admin/list", authenticate, requirePermission("riders:read"), adminGetRiders);
router.patch("/admin/approve/:riderId", authenticate, requirePermission("riders:manage"), adminApproveRider);
router.patch("/admin/reject/:riderId", authenticate, requirePermission("riders:manage"), adminRejectRider);
router.patch("/admin/suspend/:riderId", authenticate, requirePermission("riders:manage"), adminSuspendRider);
router.post("/admin/assign-order", authenticate, requirePermission("riders:manage"), adminAssignOrder);

export default router;
