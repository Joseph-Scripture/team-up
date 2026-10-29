import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { validate }     from "../middleware/validateResults.js";
import {
  listNotificationsRules,
  notificationIdParamRules,
} from "../middleware/validateNotification.js";
import {
  ListNotifications,
  MarkAsRead,
  MarkAllAsRead,
} from "../controllers/notificationController.js";

const router = Router();

// All notification routes require a valid session.
router.use(authenticate);

/**
 * GET /api/notifications
 * List notifications for the authenticated user.
 * Defaults to unread only; pass ?unreadOnly=false for all.
 */
router.get(
  "/",
  listNotificationsRules,
  validate,
  ListNotifications,
);

/**
 * PATCH /api/notifications/read-all
 * Mark every unread notification as read in one shot.
 * NOTE: declared before /:notificationId/read so Express does not treat
 * the literal string "read-all" as a notification ID.
 */
router.patch(
  "/read-all",
  MarkAllAsRead,
);

/**
 * PATCH /api/notifications/:notificationId/read
 * Mark a single notification as read.
 */
router.patch(
  "/:notificationId/read",
  notificationIdParamRules,
  validate,
  MarkAsRead,
);

export default router;
