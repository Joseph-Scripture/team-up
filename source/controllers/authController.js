import { signup, login } from "../services/userAuth.js";
import {
  requestPasswordReset,
  resetPassword,
  PasswordResetError,
} from "../services/passwordResetService.js";
import {
  rotateRefreshToken,
  revokeByRefreshToken,
  revokeBySessionId,
  revokeAllSessions,
  listActiveSessions,
  setRefreshCookie,
  clearRefreshCookie,
  SessionError,
  REFRESH_COOKIE_NAME,
} from "../services/sessionService.js";

export function Signup(req, res) {
    return signup(req, res);
}
export function Login(req, res) {
    return login(req, res);
}

const RESET_REQUEST_MESSAGE = "If an active account matches that email, a password-reset link has been sent.";
function handleSessionError(res, error) {
  if (error instanceof SessionError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error("auth/session operation failed:", error);
  return res.status(500).json({ message: "Internal server error" });
}

/**
 * Exchange the refresh-token cookie for a new access token.
 * The refresh token itself is rotated: the old one is revoked and a new
 * one is set. Presenting an already-revoked token revokes the whole
 * session family (leak protection).
 */
export async function Refresh(req, res) {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!refreshToken) {
    return res.status(401).json({ message: "Refresh token required" });
  }
  try {
    const { accessToken, refreshToken: next } = await rotateRefreshToken(refreshToken, req);
    setRefreshCookie(res, next);
    return res.status(200).json({ message: "Token refreshed", token: accessToken });
  } catch (error) {
    clearRefreshCookie(res);
    return handleSessionError(res, error);
  }
}

/**
 * Log out: revoke the session family of the presented refresh token
 * (cookie) or, failing that, of the access token's session. Idempotent.
 */
export async function Logout(req, res) {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (refreshToken) {
      await revokeByRefreshToken(refreshToken);
    } else if (req.sessionId) {
      // No cookie (e.g. mobile client): revoke via the access token's session.
      await revokeBySessionId(req.sessionId);
    }
    clearRefreshCookie(res);
    return res.status(200).json({ message: "Logged out" });
  } catch (error) {
    return handleSessionError(res, error);
  }
}

/** Log out everywhere: revoke every session of the current user. */
export async function LogoutAll(req, res) {
  try {
    const revoked = await revokeAllSessions(req.user.id);
    clearRefreshCookie(res);
    return res.status(200).json({ message: "Logged out of all sessions", revoked });
  } catch (error) {
    return handleSessionError(res, error);
  }
}

/** List the user's active sessions (devices). */
export async function Sessions(req, res) {
  try {
    const sessions = await listActiveSessions(req.user.id, req.sessionId);
    return res.status(200).json({ sessions });
  } catch (error) {
    return handleSessionError(res, error);
  }
}

/** Request a reset email without revealing whether an account exists. */
export async function ForgotPassword(req, res) {
  try {
    await requestPasswordReset(req.body.email);
  } catch (error) {
    // Preserve the same response for known and unknown addresses. Operators can
    // still diagnose an SMTP problem from the server log.
    console.error("password-reset email failed:", error.message);
  }
  return res.status(202).json({ message: RESET_REQUEST_MESSAGE });
}

/** Consume a one-time reset token, update the password, and revoke sessions. */
export async function ResetPassword(req, res) {
  try {
    await resetPassword(req.body.token, req.body.password);
    clearRefreshCookie(res);
    return res.status(200).json({ message: "Password reset successfully. Please sign in again." });
  } catch (error) {
    if (error instanceof PasswordResetError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error("password reset failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
