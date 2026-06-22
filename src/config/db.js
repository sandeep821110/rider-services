import mongoose from "mongoose";
import logger from "../utils/logger.js";

export const checkDBHealth = () => {
  const state = mongoose.connection.readyState;
  const stateMap = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };
  const status = stateMap[state] || "unknown";
  return {
    status: state === 1 ? "healthy" : "unhealthy",
    message: `MongoDB is ${status}`,
    state,
    connected: state === 1,
    host: mongoose.connection.host || null,
    db: mongoose.connection.name || null,
  };
};

export const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    logger.info("MongoDB connected");
  } catch (error) {
    logger.error("MongoDB connection error:", error);
    throw error;
  }
};

mongoose.connection.on("error", (err) => {
  logger.error("Mongoose connection error:", err.message);
});

mongoose.connection.on("disconnected", () => {
  logger.warn("Mongoose disconnected from MongoDB");
});
