import redis from "../config/redis.js";
import logger from "../utils/logger.js";

const OTP_TTL_SECONDS = 300;
const MAX_VERIFY_ATTEMPTS = 5;

const memoryStore = new Map();
let useRedis = true;

const redisAvailable = async () => {
  if (!useRedis) return false;
  try {
    await redis.ping();
    return true;
  } catch {
    useRedis = false;
    logger.warn("Redis unavailable, falling back to in-memory OTP store");
    return false;
  }
};

const setOTP = async (key, otp) => {
  if (await redisAvailable()) {
    await redis.setex(key, OTP_TTL_SECONDS, otp);
  } else {
    memoryStore.set(key, { otp, expiresAt: Date.now() + OTP_TTL_SECONDS * 1000 });
  }
};

const getOTP = async (key) => {
  if (await redisAvailable()) {
    return await redis.get(key);
  }
  const entry = memoryStore.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return entry.otp;
};

const delOTP = async (key) => {
  if (await redisAvailable()) {
    await redis.del(key);
  } else {
    memoryStore.delete(key);
  }
};

const incrAttempts = async (key) => {
  if (await redisAvailable()) {
    const val = await redis.incr(key);
    return val;
  }
  const entry = memoryStore.get(key) || { attempts: 0, expiresAt: Date.now() + OTP_TTL_SECONDS * 1000 };
  entry.attempts = (entry.attempts || 0) + 1;
  memoryStore.set(key, entry);
  return entry.attempts;
};

const expireKey = async (key) => {
  if (await redisAvailable()) {
    await redis.expire(key, OTP_TTL_SECONDS);
  }
};

export const generateOTP = async (email) => {
  try {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await setOTP(`rider_otp:${email}`, otp);
    logger.info(`OTP generated for rider email: ${email}`);
    return otp;
  } catch (error) {
    logger.error("Error generating OTP:", error);
    throw error;
  }
};

export const verifyOTP = async (email, otp) => {
  try {
    const savedOTP = await getOTP(`rider_otp:${email}`);

    if (!savedOTP) {
      logger.warn(`OTP not found or expired for rider email: ${email}`);
      return false;
    }

    if (savedOTP !== otp) {
      logger.warn(`Invalid OTP attempt for rider email: ${email}`);

      const attemptsKey = `rider_otp_attempts:${email}`;
      const attempts = await incrAttempts(attemptsKey);
      if (attempts === 1) {
        await expireKey(attemptsKey);
      }
      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        await delOTP(`rider_otp:${email}`);
        logger.warn(`OTP brute force detected for rider email: ${email}. OTP deleted.`);
      }

      return false;
    }

    await delOTP(`rider_otp:${email}`);
    await delOTP(`rider_otp_attempts:${email}`);

    logger.info(`OTP verified successfully for rider email: ${email}`);
    return true;
  } catch (error) {
    logger.error("Error verifying OTP:", error);
    throw error;
  }
};

export const generateDeliveryOTP = async (orderId) => {
  try {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await setOTP(`delivery_otp:${orderId}`, otp);
    logger.info(`Delivery OTP generated for order: ${orderId}`);
    return otp;
  } catch (error) {
    logger.error("Error generating delivery OTP:", error);
    throw error;
  }
};

export const verifyDeliveryOTP = async (orderId, otp) => {
  try {
    const savedOTP = await getOTP(`delivery_otp:${orderId}`);

    if (!savedOTP) {
      logger.warn(`Delivery OTP not found or expired for order: ${orderId}`);
      return false;
    }

    if (savedOTP !== otp) {
      logger.warn(`Invalid delivery OTP attempt for order: ${orderId}`);

      const attemptsKey = `delivery_otp_attempts:${orderId}`;
      const attempts = await incrAttempts(attemptsKey);
      if (attempts === 1) {
        await expireKey(attemptsKey);
      }
      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        await delOTP(`delivery_otp:${orderId}`);
        logger.warn(`Delivery OTP brute force detected for order: ${orderId}. OTP deleted.`);
      }

      return false;
    }

    await delOTP(`delivery_otp:${orderId}`);
    await delOTP(`delivery_otp_attempts:${orderId}`);

    logger.info(`Delivery OTP verified successfully for order: ${orderId}`);
    return true;
  } catch (error) {
    logger.error("Error verifying delivery OTP:", error);
    throw error;
  }
};

export default { generateOTP, verifyOTP, generateDeliveryOTP, verifyDeliveryOTP };
