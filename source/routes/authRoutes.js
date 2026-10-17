import { Router } from "express";
import { Signup, Login, Refresh, Logout, LogoutAll, Sessions } from "../controllers/authController.js";
import { signupRules, loginRules } from "../middleware/authMiddleware.js";
import { authenticate } from "../middleware/authenticate.js";
import { validate } from "../middleware/validateResults.js";
import { REFRESH_COOKIE_NAME } from "../services/sessionService.js";

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
route.post("/signup", signupRules, validate, Signup);

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
route.post("/login", loginRules, validate, Login);

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