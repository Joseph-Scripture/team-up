import nodemailer from "nodemailer";
import config from "../../config.js";

export class MailerError extends Error {
  constructor(message) {
    super(message);
    this.name = "MailerError";
  }
}

let transporter;

function getTransporter() {
  if (!config.SMTP_URL || !config.EMAIL_FROM) {
    throw new MailerError("Email delivery is not configured");
  }
  if (!transporter) {
    transporter = nodemailer.createTransport(config.SMTP_URL);
  }
  return transporter;
}

export async function sendPasswordResetEmail({ recipient, resetUrl }) {
  await getTransporter().sendMail({
    from: config.EMAIL_FROM,
    to: recipient,
    subject: "Reset your TeamUP password",
    text: [
      "We received a request to reset your TeamUP password.",
      "",
      `Reset your password: ${resetUrl}`,
      "",
      `This link expires in ${config.PASSWORD_RESET_TTL_MINUTES} minutes and can be used once.`,
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: `
      <p>We received a request to reset your TeamUP password.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>This link expires in ${config.PASSWORD_RESET_TTL_MINUTES} minutes and can be used once.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
  });
}
