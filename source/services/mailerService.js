import config from "../../config.js";

const REQUEST_TIMEOUT_MS = 15_000;

export class MailerError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message);
    this.name = "MailerError";
    if (status !== undefined) this.status = status;
    if (cause !== undefined) this.cause = cause;
  }
}

function assertConfigured() {
  if (!config.SEND_LIBERTY_API_KEY) {
    throw new MailerError("Email delivery is not configured: SEND_LIBERTY is missing");
  }
  if (!config.EMAIL_FROM) {
    throw new MailerError("Email delivery is not configured: EMAIL_FROM is missing");
  }
}

function buildMessage({ recipient, resetUrl }) {
  const expires = `${config.PASSWORD_RESET_TTL_MINUTES} minutes`;

  return {
    from: config.EMAIL_FROM,
    to: recipient,
    subject: "Reset your TeamUP password",
    text: [
      "We received a request to reset your TeamUP password.",
      "",
      `Reset your password: ${resetUrl}`,
      "",
      `This link expires in ${expires} and can be used once.`,
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: `
      <p>We received a request to reset your TeamUP password.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>This link expires in ${expires} and can be used once.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
    ...(config.EMAIL_REPLY_TO ? { replyTo: config.EMAIL_REPLY_TO } : {}),
  };
}

/**
 * Sends the password-reset email through SendLiberty's HTTP API.
 *
 * SendLiberty replaces SMTP so the API can run on hosts that block outbound
 * SMTP connections (for example Render's free tier). Delivery failures throw a
 * MailerError; the caller keeps the public response generic and logs the error.
 */
export async function sendPasswordResetEmail({ recipient, resetUrl }) {
  assertConfigured();

  let response;
  try {
    response = await fetch(config.SEND_LIBERTY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.SEND_LIBERTY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildMessage({ recipient, resetUrl })),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Network errors and the timeout abort land here.
    throw new MailerError(`Could not reach SendLiberty: ${error.message}`, {
      cause: error,
    });
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const statusText = response.statusText ? ` ${response.statusText}` : "";
    const retryAfterSeconds = Number.parseInt(
      response.headers.get("retry-after") ?? "",
      10,
    );
    const retryNote = Number.isFinite(retryAfterSeconds)
      ? `; retry after ${retryAfterSeconds}s`
      : "";

    const error = new MailerError(
      `SendLiberty rejected the email (${response.status}${statusText}${retryNote})${detail ? `: ${detail.slice(0, 500)}` : ""}`,
      { status: response.status },
    );
    if (Number.isFinite(retryAfterSeconds)) {
      error.retryAfter = retryAfterSeconds;
    }
    throw error;
  }

  return response.json().catch(() => ({}));
}
