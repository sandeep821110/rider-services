import amqp from "amqplib";
import logger from "../utils/logger.js";

let channel = null;

export const connectRabbitMQ = async () => {
  try {
    const connection = await amqp.connect(
      process.env.RABBITMQ_URL || "amqp://localhost"
    );
    channel = await connection.createChannel();
    logger.info("RabbitMQ connected");
  } catch (error) {
    logger.error("RabbitMQ connection failed:", error.message);
    logger.warn("Running in degraded mode without RabbitMQ");
  }
};

export const getChannel = () => channel;
