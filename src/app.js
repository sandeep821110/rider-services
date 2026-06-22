import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
dotenv.config();
import { connectDB, checkDBHealth } from "./config/db.js";
import { connectRabbitMQ, checkRabbitMQHealth, isRabbitMQConnected, getRabbitMQStatus } from "./config/rabbitmq.js";
import { checkRedisHealth, isRedisAvailable, getRedisStatus } from "./config/redis.js";
import riderRoutes from "./routes/rider.routes.js";
import logger from "./utils/logger.js";

const app = express();
const PORT = process.env.RIDER_SERVICE_PORT || 7011;

app.use(helmet());
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(s => s.trim()).filter(Boolean)
  : ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (corsOrigins.includes(origin)) return callback(null, true);
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '5mb' }));

app.get("/health", async (req, res, next) => {
  try {
    const dbHealth = checkDBHealth();
    const redisHealth = await checkRedisHealth();
    const rabbitMQHealth = await checkRabbitMQHealth();

    const allHealthy = dbHealth.status === "healthy" && redisHealth.status === "healthy" && rabbitMQHealth.status === "healthy";
    const overallStatus = allHealthy ? "healthy" : "degraded";

    res.status(allHealthy ? 200 : 503).json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        mongodb: {
          status: dbHealth.status,
          message: dbHealth.message,
          connected: dbHealth.connected,
          host: dbHealth.host,
          db: dbHealth.db,
        },
        redis: {
          status: redisHealth.status,
          message: redisHealth.message,
          connected: redisHealth.connected,
          available: isRedisAvailable(),
          details: getRedisStatus(),
        },
        rabbitmq: {
          status: rabbitMQHealth.status,
          message: rabbitMQHealth.message,
          connected: rabbitMQHealth.connected,
          available: isRabbitMQConnected(),
          details: getRabbitMQStatus(),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

app.use("/api/riders", riderRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
});

app.use((err, req, res, next) => {
  logger.error("Unhandled error:", err);
  res.status(500).json({ success: false, message: "Internal server error" });
});

const start = async () => {
  try {
    await connectDB();
    await connectRabbitMQ();
    app.listen(PORT, () => {
      logger.info(`Rider service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
};

start();

export default app;
