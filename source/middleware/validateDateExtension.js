import { body, param, query } from "express-validator";

const VALID_STATUSES = ["PENDING", "ACCEPTED", "DECLINED", "WITHDRAWN"];
const DECISION_STATUSES = ["ACCEPTED", "DECLINED", "WITHDRAWN"];

const projectIdParam = param("projectId")
  .isString().trim().notEmpty().withMessage("projectId is required");

const requestIdParam = param("requestId")
  .isString().trim().notEmpty().withMessage("requestId is required");

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/date-extension-requests
// ─────────────────────────────────────────────────────────────────────────────

export const createDateExtensionRequestRules = [
  projectIdParam,

  body("taskId")
    .optional({ values: "null" })
    .isString().trim().notEmpty()
    .withMessage("taskId must be a non-empty string"),

  body("requestedDate")
    .isISO8601().withMessage("requestedDate is required and must be a valid ISO 8601 date")
    .toDate(),

  body("reason")
    .isString().withMessage("reason is required").bail()
    .trim().notEmpty().withMessage("reason must not be empty")
    .isLength({ max: 1000 }).withMessage("reason must be at most 1000 characters"),
];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/date-extension-requests
// ─────────────────────────────────────────────────────────────────────────────

export const listProjectDateExtensionRequestsRules = [
  projectIdParam,

  query("status")
    .optional()
    .isString().trim().toUpperCase()
    .isIn(VALID_STATUSES)
    .withMessage(`status must be one of: ${VALID_STATUSES.join(", ")}`),

  query("taskId")
    .optional()
    .isString().trim().notEmpty()
    .withMessage("taskId must be a non-empty string"),

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
// GET /api/date-extension-requests
// ─────────────────────────────────────────────────────────────────────────────

export const listMyDateExtensionRequestsRules = [
  query("status")
    .optional()
    .isString().trim().toUpperCase()
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
// GET /api/projects/:projectId/date-extension-requests/:requestId
// ─────────────────────────────────────────────────────────────────────────────

export const dateExtensionRequestParamRules = [projectIdParam, requestIdParam];

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/projects/:projectId/date-extension-requests/:requestId
// ─────────────────────────────────────────────────────────────────────────────

export const updateDateExtensionRequestRules = [
  projectIdParam,
  requestIdParam,

  body("status")
    .isString().withMessage("status is required").bail()
    .trim().toUpperCase()
    .isIn(DECISION_STATUSES)
    .withMessage(`status must be one of: ${DECISION_STATUSES.join(", ")}`),

  body("decisionNote")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 500 }).withMessage("decisionNote must be at most 500 characters"),
];
