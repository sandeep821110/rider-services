import Redis from "ioredis";
import logger from "../utils/logger.js";

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
redis.on("ready", () => logger.info("Redis ready"));
redis.on("error", (err) => logger.warn("Redis error:", err.message));

export default redis;
