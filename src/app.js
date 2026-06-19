import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
dotenv.config();
import { connectDB } from "./config/db.js";
import { connectRabbitMQ } from "./config/rabbitmq.js";
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

app.get("/health", (req, res) => {
  res.json({ status: "OK", message: "Rider service is running" });
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
