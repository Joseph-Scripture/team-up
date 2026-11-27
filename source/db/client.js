import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { warmUpConnection } from "../lib/dbErrors.js";

// pg.Pool options — PrismaPg passes this config straight to `new pg.Pool()`.
// Both values exist because the database is remote (Neon, eu-west-2) behind
// a link where a fresh TLS handshake takes 1–12s and can be reset mid-flight:
//
// - idleTimeoutMillis: pg's default is 10_000, so every request after 10s of
//   quiet paid a brand-new multi-second handshake — and a handshake that got
//   reset surfaced as ECONNRESET → HTTP 500. Keeping connections warm for 60s
//   makes steady traffic reuse the pool instead of re-dialing.
// - connectionTimeoutMillis: pg's default is 0 = wait forever, which made
//   requests hang until the frontend timed out. Fail after 15s instead so the
//   error handler can answer 503 (with Retry-After) rather than hanging.
export const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: 15_000,
};

const adapter = new PrismaPg(poolConfig);

const prisma = new PrismaClient({
  adapter,
  transactionOptions: {
    // Prisma defaults to a 5s interactive-transaction timeout. Remote database
    // round-trips can exceed that during slow or congested connections, which
    // surfaces as a P2028 "transaction expired" error (HTTP 500). The database
    // this API runs against has ~1s round-trip latency, so a transaction that
    // touches several tables needs a much larger budget.
    timeout: 120000, // 2 minutes for the transaction body to finish
    maxWait: 30000, // 30 seconds to wait for a pooled connection / transaction start
    isolationLevel: "ReadCommitted",
  },
});
export default prisma;

/**
 * Pre-open a pooled connection so the first user request doesn't pay the
 * multi-second TLS handshake, and so a dead link is reported at boot.
 * Never throws and never blocks startup: resolves `false` when the database
 * is unreachable (the API still serves /health and answers 503 elsewhere).
 *
 * @param {{ retries?: number, delays?: number[] }} [options]
 * @returns {Promise<boolean>}
 */
export function warmUpPool(options) {
  return warmUpConnection(() => prisma.$queryRaw`SELECT 1`, options);
}
