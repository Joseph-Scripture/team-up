import { body, param, query } from "express-validator";

const VALID_STATUSES = ["PENDING", "ACCEPTED", "DECLINED", "WITHDRAWN"];

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/join-requests
// ─────────────────────────────────────────────────────────────────────────────

export const sendJoinRequestRules = [
  param("projectId")
    .isString().trim().notEmpty()
    .withMessage("projectId is required"),

  body("roleId")
    .isString().withMessage("roleId is required").bail()
    .trim().notEmpty().withMessage("roleId must not be empty"),

  body("message")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 1000 }).withMessage("Message must be at most 1000 characters"),

  body("proposedHoursPerWeek")
    .optional({ values: "null" })
    .isInt({ min: 1, max: 168 }).withMessage("proposedHoursPerWeek must be between 1 and 168")
    .toInt(),

  body("plannedTaskDeadlines")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 2000 }).withMessage("plannedTaskDeadlines must be at most 2000 characters"),
];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/join-requests
// ─────────────────────────────────────────────────────────────────────────────

export const listProjectJoinRequestsRules = [
  param("projectId")
    .isString().trim().notEmpty()
    .withMessage("projectId is required"),

  query("status")
    .optional()
    .isString().trim()
    .toUpperCase()
    .isIn(VALID_STATUSES)
    .withMessage(`status must be one of: ${VALID_STATUSES.join(", ")}`),

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
// GET /api/join-requests  (my sent requests)
// ─────────────────────────────────────────────────────────────────────────────

export const listMyJoinRequestsRules = [
  query("status")
    .optional()
    .isString().trim()
    .toUpperCase()
    .isIn(VALID_STATUSES)
    .withMessage(`status must be one of: ${VALID_STATUSES.join(", ")}`),

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
// Shared: request ID param
// ─────────────────────────────────────────────────────────────────────────────

export const joinRequestIdParamRules = [
  param("requestId")
    .isString().trim().notEmpty()
    .withMessage("requestId is required"),
];

export const projectAndRequestIdParamRules = [
  param("projectId")
    .isString().trim().notEmpty()
    .withMessage("projectId is required"),

  param("requestId")
    .isString().trim().notEmpty()
    .withMessage("requestId is required"),
];

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/join-requests/:requestId/approve|decline
// ─────────────────────────────────────────────────────────────────────────────

export const decisionRules = [
  ...projectAndRequestIdParamRules,

  body("decisionNote")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 500 }).withMessage("decisionNote must be at most 500 characters"),
];
