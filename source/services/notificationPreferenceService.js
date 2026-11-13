import prisma from "../db/client.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants — mirrors the NotificationType and NotificationChannel enums
// ─────────────────────────────────────────────────────────────────────────────

export const NOTIFICATION_TYPES = [
  "PROJECT_INVITATION",
  "INVITATION_RESPONDED",
  "JOIN_REQUEST",
  "JOIN_REQUEST_DECIDED",
  "MEMBER_JOINED",
  "MEMBER_LEFT",
  "TASK_ASSIGNED",
  "TASK_COMMENTED",
  "TASK_DEADLINE",
  "TASK_OVERDUE",
  "MILESTONE_UPDATE",
  "TEAM_UPDATE",
  "CONTRIBUTION_REVIEW",
  "PROJECT_COMPLETED",
];

export const NOTIFICATION_CHANNELS = ["IN_APP", "EMAIL"];

// ─────────────────────────────────────────────────────────────────────────────
// Custom error
// ─────────────────────────────────────────────────────────────────────────────

export class PreferenceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name   = "PreferenceError";
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getPreferences
// Returns the full preference state for all type+channel combinations.
// If a row doesn't exist in the DB it means the user has never changed it
// from the default (enabled = true), so we fill those in.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all notification preferences for the authenticated user.
 * Rows that don't exist in the DB are returned with enabled: true (default).
 *
 * @param {string} userId
 * @returns {object[]} Array of { type, channel, enabled } for every combination
 */
export async function getPreferences(userId) {
  const stored = await prisma.notificationPreference.findMany({
    where: { userId },
    select: { type: true, channel: true, enabled: true },
  });

  // Build a lookup map from stored rows
  const lookup = new Map(stored.map((p) => [`${p.type}:${p.channel}`, p.enabled]));

  // Return the full matrix — every type × channel combination — filling in
  // `enabled: true` for rows that have never been explicitly configured.
  const preferences = [];
  for (const type of NOTIFICATION_TYPES) {
    for (const channel of NOTIFICATION_CHANNELS) {
      const key = `${type}:${channel}`;
      preferences.push({
        type,
        channel,
        enabled: lookup.has(key) ? lookup.get(key) : true,
      });
    }
  }

  return preferences;
}

// ─────────────────────────────────────────────────────────────────────────────
// updatePreferences
// Accepts an array of { type, channel, enabled } and upserts each row.
// Only the combinations provided in the request are updated — others unchanged.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upsert one or more notification preference rows.
 *
 * @param {string} userId
 * @param {Array<{ type: string, channel: string, enabled: boolean }>} updates
 * @returns {object[]} The full updated preference matrix (same shape as getPreferences)
 */
export async function updatePreferences(userId, updates) {
  // Upsert each preference in a transaction so either all succeed or none do.
  await prisma.$transaction(
    updates.map(({ type, channel, enabled }) =>
      prisma.notificationPreference.upsert({
        where:  { userId_type_channel: { userId, type, channel } },
        update: { enabled },
        create: { userId, type, channel, enabled },
      }),
    ),
  );

  // Return the full preference matrix after the update.
  return getPreferences(userId);
}
