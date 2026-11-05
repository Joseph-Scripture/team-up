import rateLimit from "express-rate-limit";

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