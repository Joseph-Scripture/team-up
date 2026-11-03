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

const NODE_ENV = process.env.NODE_ENV ?? "development";

// Comma-separated list of allowed origins, e.g.:
//   ALLOWED_ORIGINS=https://teamup-lattice-project.netlify.app,http://localhost:5173
// Defaults to the Netlify frontend in production, localhost:5173 in development.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim().replace(/\/$/, ""))
  : NODE_ENV === "production"
    ? ["https://teamup-lattice-project.netlify.app,https://teamup-frontend-vert.vercel.app/"]
    : [
        "https://teamup-lattice-project.netlify.app,https://teamup-frontend-vert.vercel.app/",

        // Vite (default + overflow ports)
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",

        // Create React App
        "http://localhost:3000",

        // Next.js
        "http://localhost:3001",

        // Live Server (VS Code extension) — both variants
        "http://localhost:5500",
        "http://127.0.0.1:5500",

        // Generic fallbacks
        "http://localhost:4173", // Vite preview
        "http://localhost:8080", // webpack-dev-server
      ];

export default {
  NODE_ENV,
  isProduction: NODE_ENV === "production",
  ALLOWED_ORIGINS,

  PORT: Number(process.env.PORT ?? 4000),

  JWT_SECRET,

  // Access token: short-lived JWT. Revoked by deleting/revoking its
  // Session row (authenticate.js checks the session on every request).
  ACCESS_TOKEN_TTL: process.env.ACCESS_TOKEN_TTL ?? "15m", // jsonwebtoken format

  // Refresh token: opaque random string, stored hashed in Session.
  // Sliding lifetime — each rotation extends it.
  REFRESH_TOKEN_TTL_DAYS: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
};
