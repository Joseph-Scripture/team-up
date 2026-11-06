import { Router } from "express";
import { Signup, Login, Refresh, Logout, LogoutAll, Sessions, ForgotPassword, ResetPassword } from "../controllers/authController.js";
import { signupRules, loginRules, forgotPasswordRules, resetPasswordRules } from "../middleware/authMiddleware.js";
import { authenticate } from "../middleware/authenticate.js";
import { validate } from "../middleware/validateResults.js";
import { REFRESH_COOKIE_NAME } from "../services/sessionService.js";
import { authLimiter } from "../middleware/ratelimiter.js";

const route = Router();

// Logout works with either a refresh cookie or a Bearer token; only
// fall back to full authentication when no cookie is presented.
const authenticateIfBearer = (req, res, next) =>
  req.cookies?.[REFRESH_COOKIE_NAME] ? next() : authenticate(req, res, next);

/**
 * @openapi
 * /api/auth/signup:
 *   post:
 *     tags: [Auth]
 *     summary: Create an account
 *     description: >
 *       Creates the account, starts a session and returns a short-lived
 *       access token. The rotating refresh token is set as an httpOnly
 *       cookie (`teamup_rt`, path /api/auth) — never readable by JS.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, email, password]
 *             properties:
 *               username: { type: string, minLength: 1, maxLength: 100, example: Ada Lovelace }
 *               email: { type: string, format: email, maxLength: 255, example: ada@example.com }
 *               password: { type: string, minLength: 8, maxLength: 72, example: secure-password }
 *     responses:
 *       201:
 *         description: Account created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: User created successfully }
 *                 token: { type: string, description: Bearer token, example: eyJhbGciOiJIUzI1NiJ9... }
 *                 user:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     name: { type: string }
 *                     email: { type: string, format: email }
 *                     role: { type: string, enum: [USER, ADMIN] }
 *                     createdAt: { type: string, format: date-time }
 *       400: { description: Invalid input }
 *       409: { description: An account with this email already exists }
 *       500: { description: Internal server error }
 */
route.post("/signup", authLimiter, signupRules, validate, Signup);

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Sign in to an account
 *     description: >
 *       Starts a session and returns a short-lived access token. The
 *       rotating refresh token is set as an httpOnly cookie (`teamup_rt`,
 *       path /api/auth). Refresh it via POST /api/auth/refresh.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: ada@example.com }
 *               password: { type: string, format: password, example: secure-password }
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: Login successful }
 *                 token: { type: string, description: Bearer token }
 *                 user:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     name: { type: string }
 *                     email: { type: string, format: email }
 *                     role: { type: string, enum: [USER, ADMIN] }
 *                     createdAt: { type: string, format: date-time }
 *       400: { description: Invalid input }
 *       401: { description: Invalid email or password }
 *       403: { description: Account is disabled }
 *       500: { description: Internal server error }
 */
route.post("/login", authLimiter, loginRules, validate, Login);

/**
 * @openapi
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request a password-reset email
 *     description: >
 *       Generates a single-use, time-limited reset token and emails a link
 *       to the address. The response is always identical regardless of whether
 *       the address is registered, so email addresses cannot be enumerated.
 *
 *       The link sent to the user's inbox points to:
 *       `FRONTEND_URL/reset-password?token=<raw_token>`
 *
 *       The frontend should extract the token from the URL and submit it to
 *       `POST /api/auth/reset-password` with the new password.
 *
 *       **Token lifetime:** controlled by the `PASSWORD_RESET_TTL_MINUTES`
 *       environment variable (default 30 minutes). The token is single-use —
 *       consuming it marks it as used and cleans up any other pending tokens
 *       for the same account.
 *
 *       **SMTP required:** If `SMTP_URL` and `EMAIL_FROM` are not configured,
 *       the request is silently accepted but no email is sent.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 maxLength: 255
 *                 example: ada@example.com
 *     responses:
 *       202:
 *         description: >
 *           Request accepted. The same message is returned whether the address
 *           is registered or not.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: >
 *                     If an active account matches that email, a
 *                     password-reset link has been sent.
 *       400:
 *         description: Validation error (invalid email format)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: Invalid input }
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       field:   { type: string, example: email }
 *                       message: { type: string, example: Invalid email address }
 */
route.post("/forgot-password", authLimiter, forgotPasswordRules, validate, ForgotPassword);

/**
 * @openapi
 * /api/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password using the one-time link token
 *     description: >
 *       Consumes the reset token from the email link, updates the password,
 *       and revokes **all** active sessions so any stolen sessions are
 *       invalidated immediately.
 *
 *       **Token rules:**
 *       - Must be unused (each token is single-use).
 *       - Must not have expired (lifetime set by `PASSWORD_RESET_TTL_MINUTES`).
 *       - Submitting an already-used or expired token returns `400`.
 *       - Concurrent double-submits are handled atomically — only one request
 *         will succeed.
 *
 *       **After success:**
 *       - The refresh-token cookie is cleared.
 *       - All active sessions are revoked.
 *       - The user must sign in again with the new password.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token:
 *                 type: string
 *                 description: >
 *                   The raw token from the reset link query parameter
 *                   (?token=...). Do not hash or encode it — send it as-is.
 *                 minLength: 32
 *                 maxLength: 200
 *                 example: dGhpcyBpcyBhIHNhbXBsZSB0b2tlbg
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 maxLength: 72
 *                 description: The new password (max 72 bytes — bcrypt limit).
 *                 example: NewSecurePassword123!
 *     responses:
 *       200:
 *         description: Password changed and all sessions revoked
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Password reset successfully. Please sign in again.
 *       400:
 *         description: >
 *           Invalid, expired, or previously used token — or validation error
 *           on the password field.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Invalid or expired password reset link
 *       500: { description: Internal server error }
 */
route.post("/reset-password", authLimiter, resetPasswordRules, validate, ResetPassword);

/**
 * @openapi
 * /api/auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Rotate the refresh token and get a new access token
 *     description: >
 *       Uses the `teamup_rt` httpOnly cookie. The presented refresh
 *       token is revoked and a new one is issued (rotation). If an
 *       already-revoked token is replayed, the entire session family is
 *       revoked as a leak precaution and the request fails with 401.
 *     responses:
 *       200:
 *         description: New access token issued (and new refresh cookie set)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: Token refreshed }
 *                 token: { type: string, description: Bearer access token }
 *       401: { description: Missing, invalid, expired or replayed refresh token }
 *       500: { description: Internal server error }
 */
route.post("/refresh", Refresh);

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Log out and revoke the current session family
 *     description: >
 *       Revokes the session family behind the `teamup_rt` cookie (or the
 *       access token's session when no cookie is sent). Idempotent; the
 *       access token becomes invalid immediately.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Logged out }
 *       500: { description: Internal server error }
 */
route.post("/logout", authenticateIfBearer, Logout);

/**
 * @openapi
 * /api/auth/logout-all:
 *   post:
 *     tags: [Auth]
 *     summary: Revoke every session of the current user
 *     description: Logs out this and all other devices.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All sessions revoked
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: Logged out of all sessions }
 *                 revoked: { type: integer, example: 3 }
 *       401: { description: Missing, invalid, expired or revoked token }
 *       500: { description: Internal server error }
 */
route.post("/logout-all", authenticate, LogoutAll);

/**
 * @openapi
 * /api/auth/sessions:
 *   get:
 *     tags: [Auth]
 *     summary: List the user's active sessions (devices)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active sessions, newest activity first
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       userAgent: { type: string, nullable: true }
 *                       ipAddress: { type: string, nullable: true }
 *                       createdAt: { type: string, format: date-time }
 *                       lastUsedAt: { type: string, format: date-time, nullable: true }
 *                       expiresAt: { type: string, format: date-time }
 *                       current: { type: boolean, description: True for the calling session }
 *       401: { description: Missing, invalid, expired or revoked token }
 *       500: { description: Internal server error }
 */
route.get("/sessions", authenticate, Sessions);


export default route
