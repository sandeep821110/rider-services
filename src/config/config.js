import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const config = {
  env: process.env.NODE_ENV || "development",
  port: process.env.RIDER_SERVICE_PORT || 7011,
  mongoURI: process.env.MONGO_URI,
  redisURL: process.env.REDIS_URL,
  rabbitmqURL: process.env.RABBITMQ_URL,
  trackingServiceURL: process.env.TRACKING_SERVICE_URL || "http://localhost:2010",
  jwtSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "rider-secret-key",
  jwtExpiry: process.env.JWT_RIDER_EXPIRY || "7d",
  emailUser: process.env.EMAIL_USER || process.env.EMAIL,
  emailPass: process.env.EMAIL_PASS,
  emailFrom: process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.EMAIL,
};

const requiredConfigs = ["mongoURI"];
const missingConfigs = requiredConfigs.filter((key) => !config[key]);

if (missingConfigs.length > 0) {
  throw new Error(`Missing required environment variables: ${missingConfigs.join(", ")}`);
}

export default config;
