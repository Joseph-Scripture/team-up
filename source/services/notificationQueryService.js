import prisma from "../db/client.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const NOTIFICATIONS_PER_PAGE = 20;
const MAX_PER_PAGE           = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Custom error
// ─────────────────────────────────────────────────────────────────────────────

export class NotificationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name   = "NotificationError";
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prisma select shape — consistent across list and mark-read responses
// ─────────────────────────────────────────────────────────────────────────────

const NOTIFICATION_SELECT = {
  id:         true,
  type:       true,
  title:      true,
  message:    true,
  data:       true,
  entityType: true,
  entityId:   true,
  readAt:     true,
  createdAt:  true,
  project: {
    select: { id: true, title: true, slug: true },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// listNotifications
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return paginated notifications for the authenticated user.
 *
 * Defaults to unread only (`?unreadOnly=true`). Set `unreadOnly=false` to
 * include already-read notifications.
 *
 * Also returns `unreadCount` — the total number of unread notifications for
 * the user — so the frontend can keep its notification badge accurate without
 * a separate request.
 *
 * @param {string} userId
 * @param {object} opts
 * @param {boolean} [opts.unreadOnly=true]
 * @param {number}  [opts.page=1]
 * @param {number}  [opts.limit=20]
 */
export async function listNotifications(userId, { unreadOnly = true, page = 1, limit = NOTIFICATIONS_PER_PAGE } = {}) {
  const safePage  = Math.max(1, Number(page));
  const safeLimit = Math.min(MAX_PER_PAGE, Math.max(1, Number(limit)));
  const skip      = (safePage - 1) * safeLimit;

  const where = {
    userId,
    ...(unreadOnly && { readAt: null }),
  };

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: safeLimit,
      select: NOTIFICATION_SELECT,
    }),
    prisma.notification.count({ where }),
    // Always return the live unread badge count regardless of the filter.
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return {
    unreadCount,
    notifications,
    pagination: {
      total,
      page:       safePage,
      limit:      safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// markAsRead
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mark one notification as read for the authenticated user.
 * Returns the updated notification.
 *
 * @param {string} userId
 * @param {string} notificationId
 */
export async function markAsRead(userId, notificationId) {
  // Check the notification exists and belongs to this user before updating.
  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
    select: { id: true, readAt: true },
  });

  if (!existing) throw new NotificationError("Notification not found", 404);

  // If already read, return it as-is — idempotent, no unnecessary write.
  if (existing.readAt !== null) {
    return prisma.notification.findUnique({
      where:  { id: notificationId },
      select: NOTIFICATION_SELECT,
    });
  }

  return prisma.notification.update({
    where:  { id: notificationId },
    data:   { readAt: new Date() },
    select: NOTIFICATION_SELECT,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// markAllAsRead
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mark all unread notifications as read for the authenticated user.
 * Returns the count of notifications that were updated.
 *
 * @param {string} userId
 */
export async function markAllAsRead(userId) {
  const now = new Date();

  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data:  { readAt: now },
  });

  return { updatedCount: count };
}
