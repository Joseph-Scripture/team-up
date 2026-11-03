import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import prisma from "../db/client.js";
import config from "../../config.js";
import { sendPasswordResetEmail } from "./mailerService.js";

const TOKEN_BYTES = 32;
const SALT_ROUNDS = 12;

export class PasswordResetError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "PasswordResetError";
    this.status = status;
  }
}

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const newToken = () => crypto.randomBytes(TOKEN_BYTES).toString("base64url");

function buildResetUrl(token) {
  // In production FRONTEND_URL is the app root (e.g. https://yourapp.com) and
  // the frontend router handles /reset-password?token=...
  // In local testing, FRONTEND_URL can be the full path to the test HTML page.
  const base = config.FRONTEND_URL.endsWith('.html')
    ? config.FRONTEND_URL                          // local test page — use as-is
    : `${config.FRONTEND_URL}/reset-password`;     // production — append route
  const url = new URL(base);
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * Requests a password-reset email without revealing whether an address exists.
 * Existing unused reset links are removed before creating a new single-use link.
 */
export async function requestPasswordReset(email) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, email: true, status: true, deletedAt: true },
  });

  // Keep this outcome identical for unknown, deleted, and inactive accounts.
  if (!user || user.deletedAt || user.status !== "ACTIVE") return;

  const token = newToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(
    Date.now() + config.PASSWORD_RESET_TTL_MINUTES * 60 * 1000,
  );

  await prisma.$transaction([
    prisma.authToken.deleteMany({
      where: { userId: user.id, type: "PASSWORD_RESET", usedAt: null },
    }),
    prisma.authToken.create({
      data: { userId: user.id, type: "PASSWORD_RESET", tokenHash, expiresAt },
    }),
  ]);

  try {
    await sendPasswordResetEmail({
      recipient: user.email,
      resetUrl: buildResetUrl(token),
    });
  } catch (error) {
    // Do not leave a usable reset token behind when delivery fails.
    await prisma.authToken.deleteMany({ where: { tokenHash } });
    throw error;
  }
}

/**
 * Consumes one valid reset token, changes the password, and revokes every
 * session in one transaction. The same link cannot be used twice.
 */
export async function resetPassword(token, password) {
  const tokenHash = hashToken(token);
  const now = new Date();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const authToken = await prisma.authToken.findFirst({
    where: {
      tokenHash,
      type: "PASSWORD_RESET",
      usedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true, userId: true },
  });

  if (!authToken) {
    throw new PasswordResetError("Invalid or expired password reset link");
  }

  const result = await prisma.$transaction(async (tx) => {
    // updateMany makes consumption atomic if two requests submit the same token.
    const consumed = await tx.authToken.updateMany({
      where: {
        id: authToken.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) {
      throw new PasswordResetError("Invalid or expired password reset link");
    }

    await tx.user.update({
      where: { id: authToken.userId },
      data: { passwordHash },
    });
    const revoked = await tx.session.updateMany({
      where: { userId: authToken.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.authToken.deleteMany({
      where: {
        userId: authToken.userId,
        type: "PASSWORD_RESET",
        usedAt: null,
      },
    });
    return { revoked: revoked.count };
  });

  return result;
}
