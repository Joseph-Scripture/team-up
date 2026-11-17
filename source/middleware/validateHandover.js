import { body, param, query } from "express-validator";

const VALID_STATUSES = ["PENDING", "ACCEPTED", "DECLINED", "CANCELLED"];

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/tasks/:taskId/handover-request
// ─────────────────────────────────────────────────────────────────────────────

export const requestHandoverRules = [
  param("projectId")
    .isString().trim().notEmpty().withMessage("projectId is required"),
  param("taskId")
    .isString().trim().notEmpty().withMessage("taskId is required"),

  body("note")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 1000 }).withMessage("note must be at most 1000 characters"),
];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/handover-requests
// ─────────────────────────────────────────────────────────────────────────────

export const listHandoverRequestsRules = [
  param("projectId")
    .isString().trim().notEmpty().withMessage("projectId is required"),

  query("status")
    .optional()
    .isString().trim().toUpperCase()
    .isIn(VALID_STATUSES)
    .withMessage(`status must be one of: ${VALID_STATUSES.join(", ")}`),
];

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/handover-requests/:requestId/accept
// ─────────────────────────────────────────────────────────────────────────────

export const acceptHandoverRules = [
  param("projectId")
    .isString().trim().notEmpty().withMessage("projectId is required"),
  param("requestId")
    .isString().trim().notEmpty().withMessage("requestId is required"),

  body("assigneeMemberId")
    .isString().withMessage("assigneeMemberId is required").bail()
    .trim()
    .notEmpty().withMessage("assigneeMemberId must be a non-empty string"),

  body("handoverNote")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 1000 }).withMessage("handoverNote must be at most 1000 characters"),
];

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/handover-requests/:requestId/{decline,cancel}
// ─────────────────────────────────────────────────────────────────────────────

export const handoverRequestParamRules = [
  param("projectId")
    .isString().trim().notEmpty().withMessage("projectId is required"),
  param("requestId")
    .isString().trim().notEmpty().withMessage("requestId is required"),
];
