import Redis from "ioredis";
import logger from "../utils/logger.js";

let isRedisConnected = false;

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 3) return null;
    return Math.min(times * 200, 1000);
  },
  lazyConnect: true,
});

redis.connect().catch(() => {
  logger.warn("Redis connection failed — OTP will use in-memory fallback");
});

redis.on("connect", () => logger.info("Redis connected"));
redis.on("ready", () => {
  isRedisConnected = true;
  logger.info("Redis ready");
});
redis.on("error", (err) => {
  isRedisConnected = false;
  logger.warn("Redis error:", err.message);
});
redis.on("close", () => {
  isRedisConnected = false;
});

export const isRedisAvailable = () => isRedisConnected && redis.status === "ready";

export const getRedisStatus = () => ({
  connected: isRedisConnected,
  available: isRedisAvailable(),
  status: redis.status,
});

export const checkRedisHealth = async () => {
  if (!redis || redis.status !== "ready") {
    return { status: "unhealthy", message: "Redis client not ready", connected: isRedisConnected };
  }
  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Ping timeout")), 3000)
      ),
    ]);
    return { status: "healthy", message: pong, connected: isRedisConnected };
  } catch (error) {
    return { status: "unhealthy", message: error.message, connected: isRedisConnected };
  }
};

export default redis;
