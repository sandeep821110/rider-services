import nodemailer from "nodemailer";
import logger from "../utils/logger.js";
import { getChannel } from "../config/rabbitmq.js";
import config from "../config/config.js";

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  if (!config.emailUser || !config.emailPass) {
    logger.warn("EMAIL_USER or EMAIL_PASS not configured — direct email unavailable");
    return null;
  }

  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: config.emailUser,
      pass: config.emailPass,
    },
  });

  return transporter;
};

const sendDirectEmail = async ({ email, otp }) => {
  try {
    const t = getTransporter();
    if (!t) return false;

    await t.sendMail({
      from: config.emailFrom,
      to: email,
      subject: "Your Rider OTP Code - ChooseMood",
      html: `
        <div style="max-width: 520px; margin: 0 auto; font-family: 'Segoe UI', Roboto, Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 20px; padding: 2px;">
          <div style="background: #ffffff; border-radius: 18px; padding: 40px 36px;">
            <div style="text-align: center; margin-bottom: 28px;">
              <div style="display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 50%; margin-bottom: 14px;">
                <span style="font-size: 30px; line-height: 1;">🛵</span>
              </div>
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #1a1a2e;">Rider Verification</h1>
              <p style="margin: 6px 0 0; color: #6b7280; font-size: 15px;">Complete your rider sign-in to start delivering</p>
            </div>
            <p style="font-size: 15px; color: #374151; margin: 0 0 20px; line-height: 1.6;">Use the verification code below to complete your sign-in as a delivery rider.</p>
            <div style="background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 14px; padding: 28px 24px; text-align: center; margin-bottom: 20px;">
              <p style="margin: 0 0 16px; font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Verification Code</p>
              <div style="display: inline-block; background: #ffffff; border: 2px dashed #667eea; border-radius: 12px; padding: 16px 32px; margin-bottom: 8px;">
                <span style="font-size: 42px; letter-spacing: 14px; font-weight: 800; color: #1a1a2e; font-family: monospace;">${otp}</span>
              </div>
              <p style="margin: 14px 0 0; font-size: 14px; color: #991b1b;">⏰ This code expires in <strong>5 minutes</strong></p>
            </div>
            <div style="text-align: center; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 4px; font-size: 13px; color: #6b7280;">Team <strong>ChooseMood</strong></p>
              <p style="margin: 0; font-size: 12px; color: #9ca3af;">&copy; ${new Date().getFullYear()} ChooseMood. All rights reserved.</p>
            </div>
          </div>
        </div>
      `,
      text: `Rider OTP Verification\n\nYour rider OTP code is: ${otp}\n\nThis code expires in 5 minutes.\n\n© ${new Date().getFullYear()} ChooseMood.`,
    });

    logger.info(`Direct rider OTP email sent to: ${email}`);
    return true;
  } catch (error) {
    logger.error("Direct rider email send error:", error.message);
    return false;
  }
};

const sendViaQueue = async ({ email, name, otp }) => {
  try {
    const ch = getChannel();
    if (!ch) {
      logger.warn("RabbitMQ channel not available, falling back to direct email");
      return false;
    }

    await ch.assertQueue("email_queue", { durable: true });

    ch.sendToQueue(
      "email_queue",
      Buffer.from(JSON.stringify({
        type: "otp",
        email,
        name: name || "Rider",
        otp,
      })),
      { persistent: true }
    );

    logger.info(`OTP email queued for rider: ${email}`);
    return true;
  } catch (error) {
    logger.error("Error sending OTP via queue:", error.message);
    return false;
  }
};

export const sendOTPEmail = async ({ email, name, otp }) => {
  const queued = await sendViaQueue({ email, name, otp });
  if (queued) return true;

  const sent = await sendDirectEmail({ email, otp });
  if (sent) return true;

  logger.error("All email sending methods failed for rider OTP");
  return false;
};

export const sendDeliveryOTPEmail = async ({ email, otp, customerName }) => {
  const queued = await sendDeliveryViaQueue({ email, otp, customerName });
  if (queued) return true;

  const sent = await sendDeliveryDirectEmail({ email, otp, customerName });
  if (sent) return true;

  logger.error("All email sending methods failed for delivery OTP");
  return false;
};

const sendDeliveryViaQueue = async ({ email, otp, customerName }) => {
  try {
    const ch = getChannel();
    if (!ch) {
      logger.warn("RabbitMQ channel not available for delivery OTP");
      return false;
    }

    await ch.assertQueue("email_queue", { durable: true });

    ch.sendToQueue(
      "email_queue",
      Buffer.from(JSON.stringify({
        type: "otp-delivery",
        email,
        otp,
        name: customerName || "Customer",
      })),
      { persistent: true }
    );

    logger.info(`Delivery OTP email queued for: ${email}`);
    return true;
  } catch (error) {
    logger.error("Error sending delivery OTP via queue:", error.message);
    return false;
  }
};

const sendDeliveryDirectEmail = async ({ email, otp, customerName }) => {
  try {
    const t = getTransporter();
    if (!t) return false;

    await t.sendMail({
      from: config.emailFrom,
      to: email,
      subject: "Your Delivery OTP - ChooseMood",
      html: `
        <div style="max-width: 520px; margin: 0 auto; font-family: 'Segoe UI', Roboto, Arial, sans-serif; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 20px; padding: 2px;">
          <div style="background: #ffffff; border-radius: 18px; padding: 40px 36px;">
            <div style="text-align: center; margin-bottom: 28px;">
              <div style="display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; background: linear-gradient(135deg, #10b981, #059669); border-radius: 50%; margin-bottom: 14px;">
                <span style="font-size: 30px; line-height: 1;">&#128666;</span>
              </div>
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #1a1a2e;">Your Order is On the Way!</h1>
              <p style="margin: 6px 0 0; color: #6b7280; font-size: 15px;">A delivery partner is assigned to your order</p>
            </div>
            <p style="font-size: 15px; color: #374151; margin: 0 0 20px; line-height: 1.6;">Share this OTP with the delivery partner when they arrive to confirm your delivery.</p>
            <div style="background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 14px; padding: 28px 24px; text-align: center; margin-bottom: 20px;">
              <p style="margin: 0 0 16px; font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Delivery OTP</p>
              <div style="display: inline-block; background: #ffffff; border: 2px dashed #10b981; border-radius: 12px; padding: 16px 32px; margin-bottom: 8px;">
                <span style="font-size: 42px; letter-spacing: 14px; font-weight: 800; color: #1a1a2e; font-family: monospace;">${otp}</span>
              </div>
              <p style="margin: 14px 0 0; font-size: 14px; color: #991b1b;">&#9200; This code expires in <strong>5 minutes</strong></p>
            </div>
            <div style="text-align: center; margin-bottom: 24px;">
              <p style="margin: 0; font-size: 14px; color: #374151;">Do not share this OTP with anyone except the delivery partner.</p>
            </div>
            <div style="text-align: center; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 12px; color: #9ca3af;">&copy; ${new Date().getFullYear()} ChooseMood. All rights reserved.</p>
            </div>
          </div>
        </div>
      `,
      text: `YOUR ORDER IS ON THE WAY!\n\nShare this OTP with your delivery partner when they arrive:\n\n${otp}\n\nThis code expires in 5 minutes.\n\nDo not share this OTP with anyone except the delivery partner.`,
    });

    logger.info(`Direct delivery OTP email sent to: ${email}`);
    return true;
  } catch (error) {
    logger.error("Direct delivery email send error:", error.message);
    return false;
  }
};

export const sendDeliveryConfirmedEmail = async ({ email, customerName, orderNumber, orderId, totalAmount, items, deliveredAt }) => {
  const queued = await sendDeliveryConfirmedViaQueue({ email, customerName, orderNumber, orderId, totalAmount, items, deliveredAt });
  if (queued) return true;

  const sent = await sendDeliveryConfirmedDirectEmail({ email, customerName, orderNumber, orderId, totalAmount, items, deliveredAt });
  if (sent) return true;

  logger.error("All email sending methods failed for delivery confirmed");
  return false;
};

const sendDeliveryConfirmedViaQueue = async ({ email, customerName, orderNumber, orderId, totalAmount, items, deliveredAt }) => {
  try {
    const ch = getChannel();
    if (!ch) {
      logger.warn("RabbitMQ channel not available for delivery confirmed");
      return false;
    }

    await ch.assertQueue("email_queue", { durable: true });

    ch.sendToQueue(
      "email_queue",
      Buffer.from(JSON.stringify({
        type: "delivery-confirmed",
        email,
        customerName: customerName || "Customer",
        orderNumber: orderNumber || orderId,
        orderId,
        totalAmount,
        items: items || [],
        deliveredAt: deliveredAt || new Date().toISOString(),
      })),
      { persistent: true }
    );

    logger.info(`Delivery confirmed email queued for: ${email}`);
    return true;
  } catch (error) {
    logger.error("Error sending delivery confirmed via queue:", error.message);
    return false;
  }
};

const sendDeliveryConfirmedDirectEmail = async ({ email, customerName, orderNumber, orderId, totalAmount, items, deliveredAt }) => {
  try {
    const t = getTransporter();
    if (!t) return false;

    const orderNum = orderNumber || orderId || "N/A";
    const name = customerName || "Valued Customer";
    const date = deliveredAt ? new Date(deliveredAt).toLocaleString() : new Date().toLocaleString();

    await t.sendMail({
      from: config.emailFrom,
      to: email,
      subject: `Order Delivered - ${orderNum} - ChooseMood`,
      html: `
        <div style="max-width: 520px; margin: 0 auto; font-family: 'Segoe UI', Roboto, Arial, sans-serif; background: linear-gradient(135deg, #059669 0%, #047857 100%); border-radius: 20px; padding: 2px;">
          <div style="background: #ffffff; border-radius: 18px; padding: 40px 36px;">
            <div style="text-align: center; margin-bottom: 28px;">
              <div style="display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; background: linear-gradient(135deg, #059669, #047857); border-radius: 50%; margin-bottom: 14px;">
                <span style="font-size: 30px; line-height: 1;">&#9989;</span>
              </div>
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #1a1a2e;">Your Order Has Been Delivered!</h1>
              <p style="margin: 6px 0 0; color: #6b7280; font-size: 15px;">Thank you for shopping with ChooseMood</p>
            </div>

            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 14px; padding: 20px 24px; margin-bottom: 24px;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #374151;"><strong>Order Number:</strong> ${orderNum}</p>
              <p style="margin: 0 0 8px; font-size: 14px; color: #374151;"><strong>Delivered On:</strong> ${date}</p>
              <p style="margin: 0; font-size: 14px; color: #374151;"><strong>Delivered To:</strong> ${name}</p>
            </div>

            ${items && items.length > 0 ? `
              <div style="margin-bottom: 24px;">
                <p style="font-size: 14px; font-weight: 600; color: #374151; margin: 0 0 12px;">Items Delivered:</p>
                ${items.map(item => `
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px;">
                    <span style="color: #374151;">${item.name || "Item"}${item.quantity ? ` x${item.quantity}` : ''}</span>
                    <span style="color: #059669; font-weight: 600;">₹${item.price || 0}</span>
                  </div>
                `).join('')}
                <div style="display: flex; justify-content: space-between; padding: 12px 0 0; font-size: 16px; font-weight: 700; color: #1a1a2e;">
                  <span>Total Paid</span>
                  <span>₹${totalAmount || 0}</span>
                </div>
              </div>
            ` : ''}

            <div style="text-align: center; margin-bottom: 24px; padding: 20px; background: #fefce8; border: 1px solid #fde68a; border-radius: 14px;">
              <p style="margin: 0; font-size: 15px; color: #92400e; line-height: 1.6;">
                We hope you love your purchase! If you have any questions, feel free to contact our support team.
                Your feedback helps us improve. &#128522;
              </p>
            </div>

            <div style="text-align: center; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 4px; font-size: 13px; color: #6b7280;">Thank you for choosing <strong>ChooseMood</strong></p>
              <p style="margin: 0; font-size: 12px; color: #9ca3af;">&copy; ${new Date().getFullYear()} ChooseMood. All rights reserved.</p>
            </div>
          </div>
        </div>
      `,
      text: `ORDER DELIVERED - ${orderNum}\n\nHi ${name},\n\nYour order has been delivered successfully!\n\nOrder Number: ${orderNum}\nDelivered On: ${date}\n\n${items && items.length > 0 ? `Items:\n${items.map(item => `${item.name || "Item"} x${item.quantity || 1} - ₹${item.price || 0}`).join('\n')}\n\nTotal: ₹${totalAmount || 0}\n\n` : ''}Thank you for shopping with ChooseMood!\n\nIf you have any questions, please contact our support team.`,
    });

    logger.info(`Direct delivery confirmed email sent to: ${email}`);
    return true;
  } catch (error) {
    logger.error("Direct delivery confirmed email send error:", error.message);
    return false;
  }
};

export default { sendOTPEmail, sendDeliveryOTPEmail, sendDeliveryConfirmedEmail };
