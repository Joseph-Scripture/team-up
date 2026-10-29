import { param, query } from "express-validator";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications
// ─────────────────────────────────────────────────────────────────────────────

export const listNotificationsRules = [
  query("unreadOnly")
    .optional()
    .isBoolean({ strict: false }).withMessage("unreadOnly must be true or false")
    .toBoolean(),

  query("page")
    .optional()
    .isInt({ min: 1 }).withMessage("page must be a positive integer")
    .toInt(),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 50 }).withMessage("limit must be between 1 and 50")
    .toInt(),
];

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/notifications/:notificationId/read
// ─────────────────────────────────────────────────────────────────────────────

export const notificationIdParamRules = [
  param("notificationId")
    .isString().trim().notEmpty()
    .withMessage("notificationId is required"),
];
