import "dotenv/config"; // must run before anything reads process.env

// Central configuration. Every module reads runtime config from here so
// that env handling and validation live in exactly one place.

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const JWT_SECRET = required("JWT_SECRET");
if (JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters long");
}

// Cloudinary is required for uploads. Parse it here so the rest of the app
// can use explicit credentials and so a missing/invalid URL fails at boot
// instead of producing a generic 502 on the first upload.
const CLOUDINARY_URL = required("CLOUDINARY_URL");
let parsedCloudinaryUrl;
try {
  parsedCloudinaryUrl = new URL(CLOUDINARY_URL);
} catch {
  throw new Error("CLOUDINARY_URL is not a valid URL");
}
if (parsedCloudinaryUrl.protocol !== "cloudinary:") {
  throw new Error("CLOUDINARY_URL must start with cloudinary://");
}
const CLOUDINARY_CLOUD_NAME = parsedCloudinaryUrl.hostname;
const CLOUDINARY_API_KEY = decodeURIComponent(parsedCloudinaryUrl.username);
const CLOUDINARY_API_SECRET = decodeURIComponent(parsedCloudinaryUrl.password);
if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  throw new Error("CLOUDINARY_URL must include cloud name, API key, and API secret");
}

const NODE_ENV = process.env.NODE_ENV ?? "development";
const FRONTEND_URL = (process.env.FRONTEND_URL ?? "http://localhost:5173").trim().replace(/\/$/, "");
const PASSWORD_RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 30);
if (!Number.isInteger(PASSWORD_RESET_TTL_MINUTES) || PASSWORD_RESET_TTL_MINUTES < 5) {
  throw new Error("PASSWORD_RESET_TTL_MINUTES must be an integer of at least 5");
}

// Uploads are limited per authenticated user. Keep the production default
// conservative but give local development enough headroom to test freely.
const UPLOAD_RATE_LIMIT_MAX = Number(
  process.env.UPLOAD_RATE_LIMIT_MAX ?? (NODE_ENV === "production" ? 20 : 100),
);
if (!Number.isInteger(UPLOAD_RATE_LIMIT_MAX) || UPLOAD_RATE_LIMIT_MAX < 1) {
  throw new Error("UPLOAD_RATE_LIMIT_MAX must be a positive integer");
}

// Comma-separated list of allowed origins, e.g.:
//   ALLOWED_ORIGINS=https://teamup-lattice-project.netlify.app,http://localhost:5173
// Defaults to the Netlify frontend in production, localhost:5173 in development.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim().replace(/\/$/, ""))
  : NODE_ENV === "production"
    ? [
        "https://teamup-lattice-project.netlify.app",
        "https://teamup-frontend-vert.vercel.app",
      ]
    : [
        // Production frontends — allow in dev too so the frontend dev can test
        // against the local API without changing their env.
        "https://teamup-lattice-project.netlify.app",
        "https://teamup-frontend-vert.vercel.app",

        // Render backend (if frontend calls from the same deploy)
        "https://team-up-f4sa.onrender.com",

        // Vite (default + overflow ports)
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",

        // Create React App
        "http://localhost:3000",

        // Next.js
        "http://localhost:3001",

        // Live Server (VS Code extension)
        "http://localhost:5500",
        "http://127.0.0.1:5500",

        // Vite preview + webpack-dev-server
        "http://localhost:4173",
        "http://localhost:8080",
      ];

export default {
  NODE_ENV,
  isProduction: NODE_ENV === "production",
  ALLOWED_ORIGINS,

  PORT: Number(process.env.PORT ?? 4000),

  JWT_SECRET,

  // Cloudinary credentials (parsed from CLOUDINARY_URL at startup).
  CLOUDINARY_URL,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,

  // Maximum uploads per authenticated user per hour.
  UPLOAD_RATE_LIMIT_MAX,

  // Access token: short-lived JWT. Revoked by deleting/revoking its
  // Session row (authenticate.js checks the session on every request).
  ACCESS_TOKEN_TTL: process.env.ACCESS_TOKEN_TTL ?? "15m", // jsonwebtoken format

  // Refresh token: opaque random string, stored hashed in Session.
  // Sliding lifetime — each rotation extends it.
  REFRESH_TOKEN_TTL_DAYS: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),

  // Password-reset links are delivered by Nodemailer through this SMTP URL.
  // Example: smtps://username:password@smtp.example.com:465
  SMTP_URL: process.env.SMTP_URL?.trim() || null,
  EMAIL_FROM: process.env.EMAIL_FROM?.trim() || null,
  FRONTEND_URL,
  PASSWORD_RESET_TTL_MINUTES,

  // Redis is optional. When it is unavailable, cache helpers fall back to
  // direct database reads without affecting the API response.
  REDIS_URL: process.env.REDIS_URL?.trim() || null,
};
