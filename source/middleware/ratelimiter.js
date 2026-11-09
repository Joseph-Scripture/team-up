import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import config from "../../config.js";

// Define general rate limiter: maximum 100 requests per 15 minutes per IP
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimitheaders
  legacyHeaders: false, // Disable the `X-RateLimit headers
  message: {
    status: 429,
    error: "Too many requests from this IP, please try again after 15 minutes.",
  },
});

// Optional: A stricter limiter for sensitive routes like login/signup if needed
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // Limit each IP to 10 requests per windowMs for auth routes
  message: {
    status: 429,
    error: "Too many authentication attempts, please try again later.",
  },
});

// Limiter for POST /api/uploads.
// Keyed by authenticated user ID (falls back to IP for unauthenticated requests).
// The default is conservative in production and generous in development so
// repeated local testing does not exhaust the quota.
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: config.UPLOAD_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  // Key by user ID when available (authenticate runs first so req.user is set).
  // When falling back to IP, use the built-in ipKeyGenerator so that IPv6
  // addresses are normalised correctly — required by express-rate-limit v8.
  keyGenerator: (req, res) => {
    if (req.user?.id) return req.user.id;
    return ipKeyGenerator(req, res);
  },
  message: {
    status: 429,
    error: `Upload limit reached. You can upload up to ${config.UPLOAD_RATE_LIMIT_MAX} files per hour.`,
  },
});