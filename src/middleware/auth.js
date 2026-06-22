import jwt from "jsonwebtoken";
import config from "../config/config.js";
import logger from "../utils/logger.js";

export const authenticate = (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Access denied. No token provided." });
    }

    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, config.jwtSecret);
    const validLevels = ["superadmin", "manager", "support"];
    const rawLevel = decoded.adminLevel || "superadmin";
    const adminLevel = validLevels.includes(rawLevel) ? rawLevel : "superadmin";
    const validStatuses = ["active", "inactive", "suspended", "pending"];
    const rawStatus = decoded.status || "active";
    const status = validStatuses.includes(rawStatus) ? rawStatus : "active";
    req.user = { ...decoded, routes: decoded.routes || [], adminLevel, status };
    next();
  } catch (err) {
    logger.error("Auth middleware error:", err.message);
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

export const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }
  next();
};

export const requireAdminLevel = (...levels) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Authentication required", code: "NO_AUTH" });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required", code: "FORBIDDEN" });
  }
  if (req.user.status !== "active") {
    return res.status(403).json({ success: false, message: `Admin account is ${req.user.status}`, code: "ADMIN_NOT_ACTIVE" });
  }
  if (req.user.adminLevel === "superadmin") return next();
  if (levels.length > 0 && !levels.includes(req.user.adminLevel)) {
    return res.status(403).json({ success: false, message: "Insufficient admin permissions", code: "INSUFFICIENT_LEVEL" });
  }
  next();
};

const LEVEL_PERMISSIONS = {
  manager: ["orders:read", "orders:update", "orders:cancel", "products:create", "products:update", "tracking:read", "tracking:update", "riders:read", "riders:manage", "coupons:create", "coupons:read", "queries:read", "queries:update", "slides:create", "slides:update", "search:manage"],
  support: ["orders:read", "tracking:read", "riders:read", "coupons:read", "queries:read", "queries:update"],
};

export const requirePermission = (...perms) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Authentication required", code: "NO_AUTH" });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required", code: "FORBIDDEN" });
  }
  if (req.user.status !== "active") {
    return res.status(403).json({ success: false, message: `Admin account is ${req.user.status}`, code: "ADMIN_NOT_ACTIVE" });
  }
  if (req.user.adminLevel === "superadmin") return next();
  const userPerms = req.user.permissions || [];
  if (perms.some(p => userPerms.includes(p))) return next();
  const fallbackPerms = LEVEL_PERMISSIONS[req.user.adminLevel] || [];
  if (perms.some(p => fallbackPerms.includes(p))) return next();
  return res.status(403).json({ success: false, message: "Insufficient permissions", code: "INSUFFICIENT_PERMISSION" });
};
