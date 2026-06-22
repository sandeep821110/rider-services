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
      subject: "Your Rider OTP Code - Rocket Rush Express",
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
              <p style="margin: 0 0 4px; font-size: 13px; color: #6b7280;">Team <strong>Rocket Rush Express</strong></p>
              <p style="margin: 0; font-size: 12px; color: #9ca3af;">&copy; ${new Date().getFullYear()} Rocket Rush Express. All rights reserved.</p>
            </div>
          </div>
        </div>
      `,
      text: `Rider OTP Verification\n\nYour rider OTP code is: ${otp}\n\nThis code expires in 5 minutes.\n\n© ${new Date().getFullYear()} Rocket Rush Express.`,
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
        type: "rider-otp",
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
      subject: "Your Delivery OTP - Rocket Rush Express",
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
              <p style="margin: 0; font-size: 12px; color: #9ca3af;">&copy; ${new Date().getFullYear()} Rocket Rush Express. All rights reserved.</p>
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
      subject: `Order Delivered - ${orderNum} - Rocket Rush Express`,
      html: `
        <div style="max-width: 520px; margin: 0 auto; font-family: 'Segoe UI', Roboto, Arial, sans-serif; background: linear-gradient(135deg, #059669 0%, #047857 100%); border-radius: 20px; padding: 2px;">
          <div style="background: #ffffff; border-radius: 18px; padding: 40px 36px;">
            <div style="text-align: center; margin-bottom: 28px;">
              <div style="display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; background: linear-gradient(135deg, #059669, #047857); border-radius: 50%; margin-bottom: 14px;">
                <span style="font-size: 30px; line-height: 1;">&#9989;</span>
              </div>
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #1a1a2e;">Your Order Has Been Delivered!</h1>
              <p style="margin: 6px 0 0; color: #6b7280; font-size: 15px;">Thank you for shopping with Rocket Rush Express</p>
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
              <p style="margin: 0 0 4px; font-size: 13px; color: #6b7280;">Thank you for choosing <strong>Rocket Rush Express</strong></p>
              <p style="margin: 0; font-size: 12px; color: #9ca3af;">&copy; ${new Date().getFullYear()} Rocket Rush Express. All rights reserved.</p>
            </div>
          </div>
        </div>
      `,
      text: `ORDER DELIVERED - ${orderNum}\n\nHi ${name},\n\nYour order has been delivered successfully!\n\nOrder Number: ${orderNum}\nDelivered On: ${date}\n\n${items && items.length > 0 ? `Items:\n${items.map(item => `${item.name || "Item"} x${item.quantity || 1} - ₹${item.price || 0}`).join('\n')}\n\nTotal: ₹${totalAmount || 0}\n\n` : ''}Thank you for shopping with Rocket Rush Express!\n\nIf you have any questions, please contact our support team.`,
    });

    logger.info(`Direct delivery confirmed email sent to: ${email}`);
    return true;
  } catch (error) {
    logger.error("Direct delivery confirmed email send error:", error.message);
    return false;
  }
};

export const sendOutForDeliveryEmail = async ({ email, customerName, orderNumber, orderId, items, totalAmount, shippingAddress, riderName, riderPhone, riderVehicle, trackingNumber }) => {
  const queued = await sendOutForDeliveryViaQueue({ email, customerName, orderNumber, orderId, items, totalAmount, shippingAddress, riderName, riderPhone, riderVehicle, trackingNumber });
  if (queued) return true;

  const sent = await sendOutForDeliveryDirectEmail({ email, customerName, orderNumber, orderId, items, totalAmount, shippingAddress, riderName, riderPhone, riderVehicle, trackingNumber });
  if (sent) return true;

  logger.error("All email sending methods failed for out for delivery");
  return false;
};

const sendOutForDeliveryViaQueue = async ({ email, customerName, orderNumber, orderId, items, totalAmount, shippingAddress, riderName, riderPhone, riderVehicle, trackingNumber }) => {
  try {
    const ch = getChannel();
    if (!ch) {
      logger.warn("RabbitMQ channel not available for out for delivery");
      return false;
    }

    await ch.assertQueue("email_queue", { durable: true });

    ch.sendToQueue(
      "email_queue",
      Buffer.from(JSON.stringify({
        type: "out-for-delivery",
        email,
        customerName: customerName || "Customer",
        orderNumber: orderNumber || orderId,
        orderId,
        items: items || [],
        totalAmount,
        shippingAddress,
        riderName,
        riderPhone,
        riderVehicle,
        trackingNumber,
      })),
      { persistent: true }
    );

    logger.info(`Out for delivery email queued for: ${email}`);
    return true;
  } catch (error) {
    logger.error("Error sending out for delivery via queue:", error.message);
    return false;
  }
};

const sendOutForDeliveryDirectEmail = async ({ email, customerName, orderNumber, orderId, items, totalAmount, shippingAddress, riderName, riderPhone, riderVehicle, trackingNumber }) => {
  try {
    const t = getTransporter();
    if (!t) return false;

    const orderNum = orderNumber || orderId || "N/A";
    const name = customerName || "Valued Customer";
    const addressLines = [shippingAddress?.addressLine1, shippingAddress?.addressLine2, shippingAddress?.city, shippingAddress?.state, shippingAddress?.postalCode].filter(Boolean).join(", ") || "Address on file";
    const itemRows = (items || []).slice(0, 8).map(item => `
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #374151;">${item.name || "Item"}${item.size ? ` <span style="color: #9ca3af; font-size: 12px;">(${item.size})</span>` : ''}</td>
        <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #6b7280; text-align: center;">${item.quantity || 1}</td>
        <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #059669; text-align: right; font-weight: 600;">₹${(item.price || 0).toLocaleString()}</td>
      </tr>
    `).join("");

    const vehicleEmoji = riderVehicle === "car" ? "🚗" : riderVehicle === "scooter" ? "🛵" : "🏍️";

    await t.sendMail({
      from: config.emailFrom,
      to: email,
      subject: `🚚 Out for Delivery — ${orderNum}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; background-color: #f3f4f6;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 24px 16px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">

                  <!-- Header / Brand -->
                  <tr>
                    <td style="padding: 0 0 24px; text-align: center;">
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="font-size: 24px; font-weight: 800; color: #1a1a2e; font-family: 'Segoe UI', Roboto, Arial, sans-serif; letter-spacing: 1px;">
                            <span style="background: linear-gradient(135deg, #667eea, #764ba2); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">Rocket Rush Express</span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Hero Card -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border-radius: 20px 20px 0 0; padding: 36px 40px 28px; text-align: center;">
                      <div style="display: inline-flex; align-items: center; justify-content: center; width: 72px; height: 72px; background: rgba(255,255,255,0.2); border-radius: 50%; margin-bottom: 16px;">
                        <span style="font-size: 36px; line-height: 1;">📦</span>
                      </div>
                      <h1 style="margin: 0; font-size: 26px; font-weight: 800; color: #ffffff; font-family: 'Segoe UI', Roboto, Arial, sans-serif; letter-spacing: -0.3px;">Your Order is Out for Delivery!</h1>
                      <p style="margin: 8px 0 0; font-size: 16px; color: #fef3c7; font-family: 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.5;">Your delivery partner is on the way and will arrive shortly</p>
                    </td>
                  </tr>

                  <!-- Main Content -->
                  <tr>
                    <td style="background: #ffffff; border-radius: 0 0 20px 20px; padding: 32px 40px 36px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">

                      <!-- Greeting -->
                      <p style="margin: 0 0 20px; font-size: 16px; color: #374151; font-family: 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6;">Hi <strong style="color: #1a1a2e;">${name}</strong>,</p>
                      <p style="margin: 0 0 24px; font-size: 15px; color: #6b7280; font-family: 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6;">Great news! Your order has been picked up by our delivery partner and is now on its way to your doorstep. Here's everything you need to know:</p>

                      <!-- Order Info Card -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 14px; margin-bottom: 24px;">
                        <tr>
                          <td style="padding: 20px 24px;">
                            <table width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                <td style="padding-bottom: 10px; font-size: 13px; color: #9ca3af; font-family: 'Segoe UI', Roboto, Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Order Summary</td>
                              </tr>
                              <tr>
                                <td style="padding-bottom: 6px; font-size: 14px; color: #374151; font-family: 'Segoe UI', Roboto, Arial, sans-serif;"><strong>Order Number:</strong> ${orderNum}</td>
                              </tr>
                              ${trackingNumber ? `<tr><td style="padding-bottom: 6px; font-size: 14px; color: #374151; font-family: 'Segoe UI', Roboto, Arial, sans-serif;"><strong>Tracking ID:</strong> <span style="font-family: monospace; color: #667eea; font-weight: 600;">${trackingNumber}</span></td></tr>` : ''}
                              <tr>
                                <td style="padding-bottom: 6px; font-size: 14px; color: #374151; font-family: 'Segoe UI', Roboto, Arial, sans-serif;"><strong>Estimated Delivery:</strong> <span style="color: #059669;">Today</span></td>
                              </tr>
                              <tr>
                                <td style="font-size: 14px; color: #374151; font-family: 'Segoe UI', Roboto, Arial, sans-serif;"><strong>Payment:</strong> ${(items || []).reduce((s, i) => s + ((i.price || 0) * (i.quantity || 1)), 0).toLocaleString()}</td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <!-- Rider Info -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #eff6ff, #eef2ff); border: 1px solid #c7d2fe; border-radius: 14px; margin-bottom: 24px;">
                        <tr>
                          <td style="padding: 20px 24px;">
                            <table width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                <td style="padding-bottom: 12px; font-size: 13px; color: #6366f1; font-family: 'Segoe UI', Roboto, Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">${vehicleEmoji} Your Delivery Partner</td>
                              </tr>
                              <tr>
                                <td style="padding-bottom: 4px; font-size: 15px; color: #1a1a2e; font-family: 'Segoe UI', Roboto, Arial, sans-serif;"><strong>${riderName || "Delivery Partner"}</strong></td>
                              </tr>
                              ${riderPhone ? `<tr><td style="font-size: 14px; color: #6b7280; font-family: 'Segoe UI', Roboto, Arial, sans-serif;">📞 ${riderPhone}</td></tr>` : ''}
                              ${riderVehicle ? `<tr><td style="font-size: 14px; color: #6b7280; font-family: 'Segoe UI', Roboto, Arial, sans-serif; text-transform: capitalize;">🛻 Vehicle: ${riderVehicle}</td></tr>` : ''}
                            </table>
                          </td>
                        </tr>
                      </table>

                      <!-- Delivery Address -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 14px; margin-bottom: 24px;">
                        <tr>
                          <td style="padding: 20px 24px;">
                            <table width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                <td style="padding-bottom: 10px; font-size: 13px; color: #d97706; font-family: 'Segoe UI', Roboto, Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">📍 Delivering To</td>
                              </tr>
                              <tr>
                                <td style="font-size: 14px; color: #374151; font-family: 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6;">${addressLines}</td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <!-- Items Table -->
                      ${items && items.length > 0 ? `
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                        <tr>
                          <td style="padding-bottom: 12px; font-size: 13px; color: #9ca3af; font-family: 'Segoe UI', Roboto, Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Items in Your Order</td>
                        </tr>
                      </table>
                      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                        <thead>
                          <tr>
                            <th style="padding: 10px 0; border-bottom: 2px solid #e5e7eb; font-size: 12px; color: #9ca3af; font-family: 'Segoe UI', Roboto, Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.5px; text-align: left;">Item</th>
                            <th style="padding: 10px 0; border-bottom: 2px solid #e5e7eb; font-size: 12px; color: #9ca3af; font-family: 'Segoe UI', Roboto, Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.5px; text-align: center;">Qty</th>
                            <th style="padding: 10px 0; border-bottom: 2px solid #e5e7eb; font-size: 12px; color: #9ca3af; font-family: 'Segoe UI', Roboto, Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.5px; text-align: right;">Price</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${itemRows}
                          ${items.length > 8 ? `<tr><td colspan="3" style="padding: 12px 0; font-size: 13px; color: #9ca3af; font-family: 'Segoe UI', Roboto, Arial, sans-serif; text-align: center; font-style: italic;">+${items.length - 8} more item(s)</td></tr>` : ''}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colspan="2" style="padding: 14px 0 0; font-size: 15px; color: #1a1a2e; font-family: 'Segoe UI', Roboto, Arial, sans-serif; font-weight: 700; text-align: left;">Total</td>
                            <td style="padding: 14px 0 0; font-size: 16px; color: #059669; font-family: 'Segoe UI', Roboto, Arial, sans-serif; font-weight: 800; text-align: right;">₹${totalAmount || (items || []).reduce((s, i) => s + ((i.price || 0) * (i.quantity || 1)), 0).toLocaleString()}</td>
                          </tr>
                        </tfoot>
                      </table>
                      ` : ''}

                      <!-- CTA Section -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                        <tr>
                          <td style="text-align: center; padding: 24px 0 0;">
                            <table cellpadding="0" cellspacing="0" style="display: inline-block;">
                              <tr>
                                <td style="background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 12px; text-align: center;">
                                  <a href="${config.baseUrl || 'https://choosemood.com'}/orders/${orderId}" target="_blank" style="display: inline-block; padding: 14px 36px; font-size: 15px; font-weight: 700; color: #ffffff; font-family: 'Segoe UI', Roboto, Arial, sans-serif; text-decoration: none; letter-spacing: 0.3px;">🔴 Track Live</a>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <!-- Tips Section -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 14px; margin-bottom: 24px;">
                        <tr>
                          <td style="padding: 20px 24px;">
                            <table width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                <td style="padding-bottom: 10px; font-size: 13px; color: #16a34a; font-family: 'Segoe UI', Roboto, Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">💡 Before Your Delivery Arrives</td>
                              </tr>
                              <tr>
                                <td style="font-size: 14px; color: #374151; font-family: 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.8;">
                                  • Keep your phone nearby — your delivery partner may call<br>
                                  • Have your order details ready for quick verification<br>
                                  • For delivery, you may need to share an OTP received via SMS<br>
                                  • Inspect your package before accepting delivery
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <!-- Support Section -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 14px; margin-bottom: 24px;">
                        <tr>
                          <td style="padding: 16px 24px; text-align: center;">
                            <p style="margin: 0; font-size: 14px; color: #991b1b; font-family: 'Segoe UI', Roboto, Arial, sans-serif;">Need help? Contact us at <a href="mailto:support@choosemood.com" style="color: #dc2626; font-weight: 600; text-decoration: underline;">support@choosemood.com</a> or call +91-XXXXXXXXXX</p>
                          </td>
                        </tr>
                      </table>

                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="padding: 24px 16px 0; text-align: center;">
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding: 0 0 8px;">
                            <a href="${config.baseUrl || 'https://choosemood.com'}" style="font-size: 13px; color: #667eea; font-family: 'Segoe UI', Roboto, Arial, sans-serif; text-decoration: none; padding: 0 10px;">Website</a>
                            <span style="color: #d1d5db;">|</span>
                            <a href="${config.baseUrl || 'https://choosemood.com'}/orders" style="font-size: 13px; color: #667eea; font-family: 'Segoe UI', Roboto, Arial, sans-serif; text-decoration: none; padding: 0 10px;">My Orders</a>
                            <span style="color: #d1d5db;">|</span>
                            <a href="${config.baseUrl || 'https://choosemood.com'}/contact" style="font-size: 13px; color: #667eea; font-family: 'Segoe UI', Roboto, Arial, sans-serif; text-decoration: none; padding: 0 10px;">Support</a>
                          </td>
                        </tr>
                        <tr>
                          <td style="font-size: 12px; color: #9ca3af; font-family: 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; padding: 0 0 4px;">
                            You received this email because you placed an order on Rocket Rush Express.
                          </td>
                        </tr>
                        <tr>
                          <td style="font-size: 12px; color: #9ca3af; font-family: 'Segoe UI', Roboto, Arial, sans-serif;">
                            &copy; ${new Date().getFullYear()} Rocket Rush Express. All rights reserved.
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
      text: `OUT FOR DELIVERY — ${orderNum}

Hi ${name},

Great news! Your order is out for delivery and will arrive shortly.

── ORDER SUMMARY ──
Order Number: ${orderNum}
${trackingNumber ? `Tracking ID: ${trackingNumber}` : ''}
Estimated Delivery: Today

── DELIVERY PARTNER ──
${riderName || "Delivery Partner"}${riderPhone ? ` | ${riderPhone}` : ''}${riderVehicle ? ` | Vehicle: ${riderVehicle}` : ''}

── DELIVERING TO ──
${addressLines}

${items && items.length > 0 ? `── ITEMS ──\n${items.map(item => `  ${item.name || "Item"}${item.size ? ` (${item.size})` : ''} x${item.quantity || 1} — ₹${(item.price || 0).toLocaleString()}`).join('\n')}\n\nTotal: ₹${totalAmount || (items || []).reduce((s, i) => s + ((i.price || 0) * (i.quantity || 1)), 0).toLocaleString()}\n` : ''}
── BEFORE DELIVERY ──
• Keep your phone nearby — your delivery partner may call
• Have your order details ready for quick verification
• For delivery, you may need to share an OTP received via SMS
• Inspect your package before accepting delivery

Track your delivery in real-time: ${config.baseUrl || 'https://choosemood.com'}/orders/${orderId}

Need help? Contact us at support@choosemood.com

Thank you for choosing Rocket Rush Express!
© ${new Date().getFullYear()} Rocket Rush Express. All rights reserved.`,
    });

    logger.info(`Direct out for delivery email sent to: ${email}`);
    return true;
  } catch (error) {
    logger.error("Direct out for delivery email send error:", error.message);
    return false;
  }
};

export default { sendOTPEmail, sendDeliveryOTPEmail, sendDeliveryConfirmedEmail, sendOutForDeliveryEmail };
