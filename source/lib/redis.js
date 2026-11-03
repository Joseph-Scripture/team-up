import Redis from "ioredis";
import config from "../../config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Redis client — single shared instance for the whole process.
//
// TLS is required for Upstash (rediss:// scheme). ioredis handles this
// automatically when the URL starts with rediss://.
//
// Connection errors are logged but never crash the server — the app
// degrades gracefully to direct DB queries when Redis is unavailable.
// ─────────────────────────────────────────────────────────────────────────────

const redis = config.REDIS_URL
  ? new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck:     false,
      lazyConnect:          false,

      // Upstash closes idle TCP connections after ~30s. Sending a PING every 20s
      // keeps the connection alive and prevents the ETIMEDOUT noise on reconnect.
      keepAlive:            20000,
    })
  : null;

if (redis) {
  redis.on("connect", () => console.log("[redis] connected"));
  redis.on("ready", () => console.log("[redis] ready"));
  redis.on("error", (err) => {
    // ETIMEDOUT on idle connections is expected with managed Redis — skip the noise.
    if (err.code === "ETIMEDOUT") return;
    console.error("[redis] error:", err.message);
  });
  redis.on("close", () => console.warn("[redis] connection closed"));
} else {
  console.warn("[redis] REDIS_URL is not configured; cache is disabled");
}

export default redis;
