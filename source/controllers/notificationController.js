import { matchedData } from "express-validator";
import {
  listNotifications,
  markAsRead,
  markAllAsRead,
  NotificationError,
} from "../services/notificationQueryService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared error handler
// ─────────────────────────────────────────────────────────────────────────────

function handleError(res, error) {
  if (error instanceof NotificationError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error("notification operation failed:", error);
  return res.status(500).json({ message: "Internal server error" });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: List notifications for the authenticated user
 *     description: >
 *       Defaults to unread notifications only. Pass `?unreadOnly=false` to
 *       include already-read notifications. Always includes `unreadCount` so
 *       the frontend can keep the notification badge accurate.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unreadOnly
 *         schema: { type: boolean, default: true }
 *         description: When true (default), only returns unread notifications
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated notifications with unread badge count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 unreadCount:   { type: integer }
 *                 notifications: { type: array }
 *                 pagination:    { type: object }
 *       401: { description: Authentication required }
 */
export async function ListNotifications(req, res) {
  try {
    const filters = matchedData(req, { locations: ["query"] });
    const result  = await listNotifications(req.userId, filters);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/notifications/:notificationId/read
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/notifications/{notificationId}/read:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark a single notification as read
 *     description: >
 *       Sets `readAt` to the current timestamp. Idempotent — calling it on an
 *       already-read notification returns the notification unchanged with 200.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Notification marked as read }
 *       404: { description: Notification not found or does not belong to this user }
 *       401: { description: Authentication required }
 */
export async function MarkAsRead(req, res) {
  try {
    const { notificationId } = matchedData(req, { locations: ["params"] });
    const notification       = await markAsRead(req.userId, notificationId);
    return res.status(200).json({ notification });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/notifications/read-all
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/notifications/read-all:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark all unread notifications as read
 *     description: >
 *       Bulk marks every unread notification for the authenticated user as read.
 *       Returns the count of notifications that were updated.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All unread notifications marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 updatedCount: { type: integer }
 *       401: { description: Authentication required }
 */
export async function MarkAllAsRead(req, res) {
  try {
    const result = await markAllAsRead(req.userId);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}
