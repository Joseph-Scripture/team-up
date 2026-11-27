// ─────────────────────────────────────────────────────────────────────────────
// dbErrors — connection-failure detection, retry, and HTTP mapping
//
// The API talks to a remote PostgreSQL (Neon, eu-west-2) over a link whose
// TLS handshakes can take 1–12 seconds and occasionally get reset mid-flight.
// When that happens Prisma surfaces the failure in three different shapes
// (all observed against this database):
//
//   1. a top-level syscall code — { code: "ECONNRESET" } (the handshake was
//      dropped; this is the error that motivated this module)
//   2. a Prisma known error whose meta carries the driver-adapter cause —
//      { code: "P2010", meta: { driverAdapterError: { cause: { kind } } } }
//      where kind is DatabaseNotReachable / ConnectionClosed / SocketTimeout /
//      TlsConnectionError
//   3. a bare pg error with no usable code — message only,
//      "Connection terminated unexpectedly"
//
// isDbConnectionError() recognises all three so callers can answer 503 with a
// Retry-After header (transient: retry can succeed) instead of a generic 500
// (which reads like a bug in the API), and withDbRetry() can give a transient
// blip one more chance before giving up.
// ─────────────────────────────────────────────────────────────────────────────

// Node socket-level codes (also seen verbatim as Prisma's top-level `code`).
const SOCKET_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);

// Prisma error codes that mean "the database itself was unreachable/timed
// out", as opposed to a query-level rejection (P2002, P2025, ...).
const PRISMA_CONNECTION_CODES = new Set([
  "P1001", // Can't reach database server
  "P1002", // Database server at <host> timed out
  "P1008", // Operation timed out
  "P1017", // Server has closed the connection
]);

// driver-adapter error kinds (meta.driverAdapterError.cause.kind).
const ADAPTER_CONNECTION_KINDS = new Set([
  "DatabaseNotReachable", // ENOTFOUND / ECONNREFUSED mapped by the adapter
  "ConnectionClosed",     // ECONNRESET mapped by the adapter
  "SocketTimeout",        // ETIMEDOUT mapped by the adapter
  "TlsConnectionError",   // TLS handshake died (the "socket disconnected
                          // before secure TLS connection" failure)
  "DatabaseTimeout",
  "DatabaseClosed",
]);

// pg/Node messages for failures that arrive without a usable code. Covers
// "Connection terminated unexpectedly", pg-pool's "Connection terminated due
// to connection timeout", pg client's "timeout expired", and Node's
// "Client network socket disconnected before secure TLS connection was
// established".
const CONNECTION_MESSAGE =
  /connection terminated|connection ended|socket disconnected|timeout expired|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|SSL connection|TLS connection/i;

/**
 * True when the error means "the database was unreachable right now" rather
 * than "the query was rejected". Accepts all three shapes described above and
 * never matches domain errors (TaskError, P2002 unique violations, ...).
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isDbConnectionError(error) {
  if (!error || typeof error !== "object") return false;

  const err = /** @type {Record<string, any>} */ (error);

  // Shape 1: top-level syscall / Prisma connection code (also check `cause`,
  // because pg wraps some failures as Error(message, { cause })).
  const code = typeof err.code === "string" ? err.code : undefined;
  if (code && (SOCKET_CODES.has(code) || PRISMA_CONNECTION_CODES.has(code))) {
    return true;
  }
  const causeCode =
    err.cause && typeof err.cause === "object" && typeof err.cause.code === "string"
      ? err.cause.code
      : undefined;
  if (causeCode && (SOCKET_CODES.has(causeCode) || PRISMA_CONNECTION_CODES.has(causeCode))) {
    return true;
  }

  // Shape 2: driver-adapter error nested in Prisma's meta.
  const adapterError = err.meta?.driverAdapterError;
  const kind = adapterError?.cause?.kind ?? adapterError?.kind;
  if (typeof kind === "string" && ADAPTER_CONNECTION_KINDS.has(kind)) {
    return true;
  }

  // Shape 3: message-only pg/Node failures.
  return typeof err.message === "string" && CONNECTION_MESSAGE.test(err.message);
}

/** Response body for 503s — stable so the frontend can detect/retry on it. */
export const DB_UNAVAILABLE_MESSAGE = "Database temporarily unavailable. Please try again.";

/**
 * Answer 503 + Retry-After for a database connection failure. Used by the
 * controllers' shared error handlers and by the global Express handler.
 *
 * @param {import("express").Response} res
 * @returns {import("express").Response}
 */
export function sendDbUnavailable(res) {
  res.set("Retry-After", "1");
  return res.status(503).json({ message: DB_UNAVAILABLE_MESSAGE });
}

/**
 * Shared tail for controller error handlers: logs the failure, then answers
 * 503 + Retry-After when it was a database connection problem and a plain
 * 500 otherwise. Domain errors should be handled before calling this.
 *
 * @param {import("express").Response} res
 * @param {unknown} error
 * @param {string} logLabel — e.g. "task operation failed"
 * @returns {import("express").Response}
 */
export function sendServerError(res, error, logLabel) {
  if (isDbConnectionError(error)) {
    console.error(`${logLabel} (database unavailable):`, error);
    return sendDbUnavailable(res);
  }
  console.error(`${logLabel}:`, error);
  return res.status(500).json({ message: "Internal server error" });
}

/**
 * Run `fn` and retry once on a transient database connection failure.
 * Non-connection errors are rethrown immediately (retrying a P2002 or a
 * 404 would be wrong), and `fn` is only safe to wrap when it is idempotent
 * — reads, or operations the caller has verified are safe to repeat.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ retries?: number, delayMs?: number }} [options]
 * @returns {Promise<T>}
 */
export async function withDbRetry(fn, { retries = 1, delayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isDbConnectionError(error)) throw error;
      console.warn(
        `transient database error (attempt ${attempt + 1}/${retries + 1}), retrying in ${delayMs}ms:`,
        error instanceof Error ? error.message : error,
      );
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError; // unreachable — the loop always returns or throws
}

/**
 * Probe the database until it answers, for boot-time warm-up. Retries only
 * on connection errors (a non-connection failure will not heal by waiting),
 * and NEVER throws: an unreachable database must not stop the API from
 * starting — it should come up, log the problem, and answer 503 until the
 * link recovers.
 *
 * @param {() => Promise<unknown>} probe — e.g. () => prisma.$queryRaw`SELECT 1`
 * @param {{ retries?: number, delays?: number[] }} [options] — delays[i] ms
 *   to wait BEFORE attempt i (first delay defaults to 0 = immediate)
 * @returns {Promise<boolean>} true when the probe succeeded
 */
export async function warmUpConnection(
  probe,
  { retries = 3, delays = [0, 1000, 3000] } = {},
) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    const delay = delays[attempt] ?? delays[delays.length - 1] ?? 1000;
    if (attempt > 0 && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    try {
      await probe();
      return true;
    } catch (error) {
      lastError = error;
      if (!isDbConnectionError(error)) break; // waiting won't fix this
    }
  }
  console.warn(
    "DB warm-up failed — the API is up, but the database is unreachable; " +
      "requests will answer 503 until it recovers:",
    lastError instanceof Error ? lastError.message : lastError,
  );
  return false;
}
