import redis from "./redis.js";

// ─────────────────────────────────────────────────────────────────────────────
// TTL constants (seconds)
// ─────────────────────────────────────────────────────────────────────────────

export const TTL = {
  // Skill catalogue almost never changes — long TTL
  SKILLS:       60 * 60 * 24,      // 24 hours

  // Project detail and owner's list change on create/update/publish/delete
  PROJECT:      60 * 5,            // 5 minutes
  PROJECTS_MINE: 60 * 5,           // 5 minutes

  // Recommendations are expensive to compute; tolerate slight staleness
  RECOMMENDED:  60 * 3,            // 3 minutes

  // Milestones change when created/updated/deleted
  MILESTONES:   60 * 5,            // 5 minutes

  // Tasks change frequently (status updates, comments, contributions)
  TASKS:        60 * 2,            // 2 minutes
  TASK:         60 * 2,            // 2 minutes

  // Team updates — new posts arrive often
  UPDATES:      60 * 2,            // 2 minutes

  // User profile — changes on onboarding update
  PROFILE:      60 * 10,           // 10 minutes
};

// ─────────────────────────────────────────────────────────────────────────────
// Key builders — centralised so invalidation keys always match read keys
// ─────────────────────────────────────────────────────────────────────────────

export const CacheKey = {
  skills:        (query = "")           => `skills:${query}`,
  // Only published projects are stored under this shared key. Drafts are
  // access-controlled and must never enter a cache shared by all users.
  project:       (projectId)            => `project:public:${projectId}`,
  projectsMine:  (userId)               => `projects:mine:${userId}`,
  recommended:   (userId, limit)        => `projects:recommended:${userId}:${limit}`,
  milestones:    (projectId)            => `milestones:${projectId}`,
  tasks:         (projectId, query = "") => `tasks:${projectId}:${query}`,
  task:          (projectId, taskId)    => `task:${projectId}:${taskId}`,
  updates:       (projectId, query = "") => `updates:${projectId}:${query}`,
  profile:       (userId)               => `profile:${userId}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Core helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a cached value. Returns the parsed object or null on miss / error.
 */
export async function cacheGet(key) {
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error(`[cache] GET error for key "${key}":`, err.message);
    return null; // degrade gracefully — caller will fetch from DB
  }
}

/**
 * Set a cached value with a TTL.
 * Errors are swallowed — a failed cache write must never break a response.
 */
export async function cacheSet(key, value, ttlSeconds) {
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    console.error(`[cache] SET error for key "${key}":`, err.message);
  }
}

/**
 * Delete one or more exact keys.
 */
export async function cacheDel(...keys) {
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch (err) {
    console.error(`[cache] DEL error for keys "${keys.join(", ")}":`, err.message);
  }
}

/**
 * Delete all keys matching a glob pattern using SCAN (non-blocking).
 * Use this for invalidating a whole group, e.g. all tasks for a project.
 *
 * Pattern examples:
 *   "tasks:projectId:*"   — all task list pages for one project
 *   "milestones:*"        — every milestone list
 */
export async function cacheDelPattern(pattern) {
  if (!redis) return;
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  } catch (err) {
    console.error(`[cache] DEL PATTERN error for "${pattern}":`, err.message);
  }
}

/**
 * Cache-aside helper: read from cache, fall back to fetcher, populate cache.
 *
 * @param {string}   key        — cache key
 * @param {Function} fetcher    — async function that returns fresh data from DB
 * @param {number}   ttl        — TTL in seconds
 */
export async function withCache(key, fetcher, ttl) {
  const cached = await cacheGet(key);
  if (cached !== null) return cached;

  const fresh = await fetcher();
  if (fresh !== null && fresh !== undefined) {
    await cacheSet(key, fresh, ttl);
  }
  return fresh;
}
