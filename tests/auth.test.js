import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import jwt from "jsonwebtoken";

const SECRET = "rider-test-secret";

process.env.JWT_ACCESS_SECRET = SECRET;
process.env.JWT_SECRET = SECRET;
process.env.MONGO_URI = "mongodb://localhost:27017/rider-test";

const { authenticate, requireAdmin, requirePermission } = await import("../src/middleware/auth.js");

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const signToken = (payload) => jwt.sign(payload, SECRET);

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  delete process.env.JWT_ACCESS_SECRET;
  delete process.env.JWT_SECRET;
  delete process.env.MONGO_URI;
});

describe("authenticate", () => {
  it("should return 401 when no token is provided", () => {
    const req = { headers: {} };
    const res = mockResponse();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 for an invalid token", () => {
    const req = { headers: { authorization: "Bearer garbage" } };
    const res = mockResponse();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should authenticate a valid admin token", () => {
    const token = signToken({ id: "r1", role: "admin", adminLevel: "superadmin", status: "active" });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockResponse();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({ id: "r1", role: "admin", adminLevel: "superadmin", status: "active" });
  });

  it("should fail closed when adminLevel is missing or invalid", () => {
    const token = signToken({ id: "r2", role: "admin", status: "active" });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockResponse();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.adminLevel).toBeNull();
  });
});

describe("requireAdmin", () => {
  it("should allow an admin", () => {
    const req = { user: { id: "r1", role: "admin" } };
    const res = mockResponse();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("should deny a non-admin", () => {
    const req = { user: { id: "r1", role: "rider" } };
    const res = mockResponse();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requirePermission", () => {
  const adminRequest = (overrides = {}) => ({
    user: {
      id: "a1",
      role: "admin",
      adminLevel: "manager",
      status: "active",
      permissions: [],
      ...overrides,
    },
  });

  it("should allow a superadmin", () => {
    const req = adminRequest({ adminLevel: "superadmin" });
    const res = mockResponse();
    const next = jest.fn();

    requirePermission("riders:manage")(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("should allow a manager with the fallback permission", () => {
    const req = adminRequest({ adminLevel: "manager" });
    const res = mockResponse();
    const next = jest.fn();

    requirePermission("riders:manage")(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("should deny when adminLevel is null (fail closed)", () => {
    const req = adminRequest({ adminLevel: null });
    const res = mockResponse();
    const next = jest.fn();

    requirePermission("riders:manage")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("should deny a suspended admin", () => {
    const req = adminRequest({ adminLevel: "superadmin", status: "suspended" });
    const res = mockResponse();
    const next = jest.fn();

    requirePermission("riders:manage")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("config", () => {
  it("should reject startup when the JWT secret is not configured", async () => {
    process.env.MONGO_URI = "mongodb://localhost:27017/rider-test";

    await expect(import(`../src/config/config.js?fresh=${Date.now()}`)).rejects.toThrow(/Missing required environment variables/);
  });
});
