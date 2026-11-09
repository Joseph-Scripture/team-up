import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import config from "./config.js";
import authRoutes from "./source/routes/authRoutes.js";
import profileRoutes from "./source/routes/profileRoutes.js";
import projectRoutes from "./source/routes/projectRoutes.js";
import dashboardRoutes from "./source/routes/dashboardRoutes.js";
import invitationRoutes, { inviteeRouter } from "./source/routes/invitationRoutes.js";
import joinRequestRoutes, { requesterRouter } from "./source/routes/joinRequestRoutes.js";
import notificationRoutes from "./source/routes/notificationRoutes.js";
import uploadRoutes       from "./source/routes/uploadRoutes.js";
import { apiLimiter }      from "./source/middleware/ratelimiter.js";

const app = express();

// Render (and most hosts) terminate TLS at a proxy. Without this, req.ip is
// the proxy address and IP-based rate limits would treat every user as one.
app.set("trust proxy", 1);

// ── CORS ──────────────────────────────────────────────────────────────────────
// Must be registered before all other middleware so that preflight OPTIONS
// requests are answered without reaching auth or body-parsing middleware.
const corsOptions = {
  origin(origin, callback) {
    // Allow requests with no Origin header (server-to-server, curl, Postman).
    if (!origin) return callback(null, true);
    if (config.ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS: origin '${origin}' is not allowed`));
  },
  // Credentials: true is required so the browser sends the httpOnly refresh
  // token cookie alongside cross-origin requests.
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  // Cache the preflight response for 10 minutes to reduce OPTIONS round-trips.
  maxAge: 600,
};

// Apply CORS to every route.
app.use(cors(corsOptions));

// Explicitly handle preflight (OPTIONS) for all routes so Express does not
// fall through to other middleware before sending the 204 response.
app.options("/{*path}", cors(corsOptions));
// ─────────────────────────────────────────────────────────────────────────────

// ── Rate Limiting ─────────────────────────────────────────────────────────────
// Limit requests to 100 per 15 minutes per IP across all endpoints.
app.use("/api/", apiLimiter);
// ─────────────────────────────────────────────────────────────────────────────

// ── Swagger / OpenAPI docs ────────────────────────────────────────────────────
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "TeamUP API",
      version: "1.0.0",
      description: "REST API for the TeamUP collaborative project platform",
    },
    servers: [{ url: `http://localhost:${config.PORT}` }, {url: 'https://teamup-lattice-project.netlify.app'}],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  // Scan all route files for @openapi JSDoc comments
  apis: ["./index.js", "./source/routes/*.js", "./source/controllers/*.js"],
});

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
// Raw OpenAPI JSON (useful for importing into Postman / Insomnia)
app.get("/api/docs.json", (req, res) => res.json(swaggerSpec));
// ─────────────────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/invitations", inviteeRouter);
app.use("/api/join-requests", requesterRouter);
app.use("/api/notifications", notificationRoutes);
app.use("/api/uploads",       uploadRoutes);

/**
 * @openapi
 * /:
 *   get:
 *     tags: [General]
 *     summary: Get the API health message
 *     responses:
 *       200:
 *         description: Welcome message
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: Welcome to the home page }
 */
app.get("/health", (req, res) => {

    res.status(200).json({"message":"The api is working fine. This is the health endpoint "})
});

// ── Centralized error handler ────────────────────────────────────────────────
// Keep every error response JSON-shaped. Multer and body-parser errors would
// otherwise fall through to Express's default HTML error page.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON body" });
  }

  if (typeof err?.message === "string" && err.message.startsWith("CORS:")) {
    return res.status(403).json({ message: err.message });
  }

  const status = err?.status ?? err?.statusCode ?? 500;

  if (status >= 500) {
    console.error("Unhandled request error:", err);
  }

  return res.status(status).json({
    message: status >= 500 ? "Internal server error" : err.message,
  });
});


app.listen(config.PORT, () => {

  console.log(`Server is running on port ${config.PORT}`);

});