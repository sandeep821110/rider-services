import { jest, describe, it, expect, beforeEach } from "@jest/globals";

let stored = {};
let attempts = {};

const mockPing = jest.fn().mockResolvedValue("PONG");
const mockSetex = jest.fn().mockImplementation((key, ttl, value) => {
  stored[key] = value;
  return Promise.resolve("OK");
});
const mockGet = jest.fn().mockImplementation((key) => Promise.resolve(stored[key] || null));
const mockDel = jest.fn().mockImplementation((key) => {
  delete stored[key];
  delete attempts[key];
  return Promise.resolve(1);
});
const mockIncr = jest.fn().mockImplementation((key) => {
  attempts[key] = (attempts[key] || 0) + 1;
  return Promise.resolve(attempts[key]);
});
const mockExpire = jest.fn().mockResolvedValue(1);

jest.unstable_mockModule("../src/config/redis.js", () => ({
  default: {
    ping: mockPing,
    setex: mockSetex,
    get: mockGet,
    del: mockDel,
    incr: mockIncr,
    expire: mockExpire,
  },
}));

const { generateOTP, verifyOTP, generateDeliveryOTP, verifyDeliveryOTP } = await import("../src/services/otp.service.js");

beforeEach(() => {
  stored = {};
  attempts = {};
  jest.clearAllMocks();
});

describe("generateOTP", () => {
  it("should generate a 6-digit numeric OTP", async () => {
    const otp = await generateOTP("rider@example.com");

    expect(otp).toMatch(/^\d{6}$/);
    expect(mockSetex).toHaveBeenCalledWith("rider_otp:rider@example.com", 300, otp);
  });
});

describe("generateDeliveryOTP", () => {
  it("should generate a 6-digit delivery OTP", async () => {
    const otp = await generateDeliveryOTP("order-123");

    expect(otp).toMatch(/^\d{6}$/);
    expect(mockSetex).toHaveBeenCalledWith("delivery_otp:order-123", 300, otp);
  });
});

describe("verifyOTP", () => {
  it("should verify a correct OTP and delete it", async () => {
    const otp = await generateOTP("rider@example.com");
    const ok = await verifyOTP("rider@example.com", otp);

    expect(ok).toBe(true);
    expect(mockDel).toHaveBeenCalledWith("rider_otp:rider@example.com");
  });

  it("should reject a wrong OTP", async () => {
    await generateOTP("rider@example.com");
    const ok = await verifyOTP("rider@example.com", "000000");

    expect(ok).toBe(false);
    expect(mockIncr).toHaveBeenCalled();
  });

  it("should delete the OTP after repeated wrong attempts (brute-force protection)", async () => {
    await generateOTP("rider@example.com");

    for (let i = 0; i < 5; i++) {
      const ok = await verifyOTP("rider@example.com", "000000");
      expect(ok).toBe(false);
    }

    expect(mockDel).toHaveBeenCalledWith("rider_otp:rider@example.com");
    expect(await mockGet("rider_otp:rider@example.com")).toBeNull();
  });

  it("should return false for an expired or missing OTP", async () => {
    const ok = await verifyOTP("nobody@example.com", "123456");

    expect(ok).toBe(false);
  });
});

describe("verifyDeliveryOTP", () => {
  it("should verify a correct delivery OTP", async () => {
    const otp = await generateDeliveryOTP("order-123");
    const ok = await verifyDeliveryOTP("order-123", otp);

    expect(ok).toBe(true);
    expect(mockDel).toHaveBeenCalledWith("delivery_otp:order-123");
  });

  it("should reject a wrong delivery OTP", async () => {
    await generateDeliveryOTP("order-123");
    const ok = await verifyDeliveryOTP("order-123", "000000");

    expect(ok).toBe(false);
  });
});
