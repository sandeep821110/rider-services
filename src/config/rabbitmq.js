import amqp from "amqplib";
import logger from "../utils/logger.js";

let channel = null;
let connection = null;
let isConnected = false;

export const isRabbitMQConnected = () => isConnected && channel !== null;

export const getRabbitMQStatus = () => ({
  connected: isConnected,
  available: isRabbitMQConnected(),
  hasConnection: connection !== null,
  hasChannel: channel !== null,
});

export const checkRabbitMQHealth = async () => {
  if (!isRabbitMQConnected()) {
    return { status: "disconnected", message: "RabbitMQ not connected", connected: false };
  }
  try {
    const healthQueue = `health-check-${Date.now()}`;
    await channel.assertQueue(healthQueue, { exclusive: true });
    await channel.deleteQueue(healthQueue);
    return { status: "healthy", message: "RabbitMQ is operational", connected: true };
  } catch (error) {
    return { status: "unhealthy", message: error.message, connected: isConnected };
  }
};

export const connectRabbitMQ = async () => {
  try {
    connection = await amqp.connect(
      process.env.RABBITMQ_URL || "amqp://localhost"
    );
    channel = await connection.createChannel();
    isConnected = true;
    logger.info("RabbitMQ connected");

    connection.on("error", (err) => {
      isConnected = false;
      logger.error("RabbitMQ connection error:", err.message);
    });
    connection.on("close", () => {
      isConnected = false;
      logger.warn("RabbitMQ connection closed");
    });
  } catch (error) {
    isConnected = false;
    logger.error("RabbitMQ connection failed:", error.message);
    logger.warn("Running in degraded mode without RabbitMQ");
  }
};

export const getChannel = () => channel;
