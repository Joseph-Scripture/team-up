import jwt from "jsonwebtoken";
import config from "../config.js";
import { getValidSession } from "../services/sessionService.js";

export async function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
  } catch (err) {
    const message = err.name === "TokenExpiredError" ? "Token expired" : "Invalid token";
    return res.status(401).json({ message });
  }
  if (typeof payload.userId !== "string" || typeof payload.sid !== "string") {
    return res.status(401).json({ message: "Invalid token" });
  }

  try {
    // The access token is only as valid as its session: revoked or
    // expired session => token rejected, even if the JWT itself has
    // not expired yet. Role and status are read fresh from the DB.
    const session = await getValidSession(payload.sid);
    if (!session) {
      return res.status(401).json({ message: "Session revoked" });
    }
    const user = session.user;
    if (user.deletedAt || user.status !== "ACTIVE") {
      return res.status(401).json({ message: "Account not available" });
    }
    req.user = { id: user.id, role: user.role };
    req.userId = user.id;
    req.sessionId = payload.sid;
    return next();
  } catch (error) {
    console.error("authenticate failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ message: "Forbidden" });
