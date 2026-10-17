import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import prisma from "../db/client.js";
import config from "../config.js";

// Refresh-token sessions with rotation and theft detection.
//
// - The refresh token is an opaque 256-bit random string, delivered to
//   the client as an httpOnly cookie. Only its SHA-256 hash is stored
//   (Session.tokenHash, unique).
// - Each login starts a "family" (familyId). Every refresh REVOKES the
//   presented session and creates a new one in the same family
//   (rotation), so a token is single-use.
// - If a revoked or expired token from a family is ever presented again
//   it can only be a leak or a race with a stolen copy: the whole family
//   is revoked immediately and the attacker's copy dies with it.
// - Access tokens are 15-minute JWTs carrying the session id (sid).
//   authenticate.js checks the session row on every request, so
//   revoking a session also revokes its access token instantly.

export const REFRESH_COOKIE_NAME = "teamup_rt";

export class SessionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const REFRESH_TOKEN_BYTES = 32; // 256 bits

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const newRefreshToken = () =>
  crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");

const refreshTtlMs = () => config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

const clientMeta = (req) => ({
  userAgent: req.get("user-agent")?.slice(0, 255) ?? null,
  ipAddress: req.ip ?? null,
});

// ---------------------------------------------------------------------
// Access token
// ---------------------------------------------------------------------

export function signAccessToken(userId, sessionId) {
  return jwt.sign({ userId, sid: sessionId }, config.JWT_SECRET, {
    expiresIn: config.ACCESS_TOKEN_TTL,
    algorithm: "HS256",
  });
}

// ---------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------

/** Create a fresh session family and return the token pair. */
export async function issueTokenPair(userId, req) {
  const refreshToken = newRefreshToken();
  const session = await prisma.session.create({
    data: {
      userId,
      familyId: crypto.randomUUID(),
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + refreshTtlMs()),
      lastUsedAt: new Date(),
      ...clientMeta(req),
    },
  });
  return {
    accessToken: signAccessToken(userId, session.id),
    refreshToken,
    session,
  };
}

/**
 * Rotate a refresh token: revoke the presented session, issue a new one
 * in the same family. Throws SessionError on invalid/expired/replayed
 * tokens (replayed tokens revoke the entire family).
 */
export async function rotateRefreshToken(refreshToken, req) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
  });
  if (!session) {
    throw new SessionError(401, "Invalid refresh token");
  }

  // Replay of a token that was already rotated away or logged out:
  // assume theft and kill the whole family.
  if (session.revokedAt) {
    await revokeFamily(session.familyId);
    throw new SessionError(401, "Session has been revoked");
  }
  if (session.expiresAt <= new Date()) {
    await revokeFamily(session.familyId);
    throw new SessionError(401, "Session has expired");
  }

  const refreshToken2 = newRefreshToken();
  const [rotated, created] = await prisma.$transaction([
    // Atomic compare-and-set: only one concurrent refresh can win.
    prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.session.create({
      data: {
        userId: session.userId,
        familyId: session.familyId, // same family: replay detection still applies
        tokenHash: hashToken(refreshToken2),
        expiresAt: new Date(Date.now() + refreshTtlMs()),
        lastUsedAt: new Date(),
        ...clientMeta(req),
      },
    }),
  ]);

  if (rotated.count === 0) {
    // Lost the race against a concurrent refresh with the same token.
    await revokeFamily(session.familyId);
    throw new SessionError(401, "Session has been revoked");
  }

  return {
    accessToken: signAccessToken(session.userId, created.id),
    refreshToken: refreshToken2,
    session: created,
  };
}

/** Revoke the family (the whole rotation chain of one device/login). */
export async function revokeFamily(familyId) {
  await prisma.session.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Logout: revoke the family the presented refresh token belongs to.
 * Idempotent — an unknown token is not an error (the goal, no session,
 * is already achieved).
 */
export async function revokeByRefreshToken(refreshToken) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    select: { familyId: true },
  });
  if (session) await revokeFamily(session.familyId);
}

/** Logout without a cookie: revoke the family of a known session id. */
export async function revokeBySessionId(sessionId) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { familyId: true },
  });
  if (session) await revokeFamily(session.familyId);
}

/** Logout everywhere: revoke every session of the user. */
export async function revokeAllSessions(userId) {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Resolve the session behind an access token's `sid`, enforcing revocation. */
export async function getValidSession(sessionId) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      revokedAt: true,
      expiresAt: true,
      user: {
        select: { id: true, role: true, status: true, deletedAt: true },
      },
    },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return null;
  }
  return session;
}

/** Active sessions of a user (for a "manage devices" UI). Never exposes hashes. */
export async function listActiveSessions(userId, currentSessionId) {
  const sessions = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      userAgent: true,
      ipAddress: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
    orderBy: { lastUsedAt: "desc" },
  });
  return sessions.map((s) => ({ ...s, current: s.id === currentSessionId }));
}

// ---------------------------------------------------------------------
// Cookie helpers (httpOnly — JavaScript on the page cannot read the
// refresh token, so an XSS bug cannot steal sessions).
// ---------------------------------------------------------------------

export function setRefreshCookie(res, refreshToken) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax", // blocks cross-site POSTs => CSRF on /refresh & /logout
    path: "/api/auth", // only sent to auth endpoints
    maxAge: refreshTtlMs(),
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    path: "/api/auth",
  });
}
