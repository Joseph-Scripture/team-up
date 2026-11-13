import { param, query, body } from "express-validator";
import { NOTIFICATION_TYPES, NOTIFICATION_CHANNELS } from "../services/notificationPreferenceService.js";

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

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/notifications/preferences
// ─────────────────────────────────────────────────────────────────────────────

export const updatePreferencesRules = [
  body("preferences")
    .isArray({ min: 1 })
    .withMessage("preferences must be a non-empty array"),

  body("preferences.*.type")
    .isString().trim()
    .isIn(NOTIFICATION_TYPES)
    .withMessage(`type must be one of: ${NOTIFICATION_TYPES.join(", ")}`),

  body("preferences.*.channel")
    .isString().trim()
    .isIn(NOTIFICATION_CHANNELS)
    .withMessage(`channel must be one of: ${NOTIFICATION_CHANNELS.join(", ")}`),

  body("preferences.*.enabled")
    .isBoolean({ strict: true })
    .withMessage("enabled must be a boolean")
    .toBoolean(),
];
