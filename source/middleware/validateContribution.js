import { body, param, query } from "express-validator";

const VALID_STATUSES  = ["PENDING_REVIEW", "CONFIRMED", "CHANGES_REQUESTED"];
const VALID_DECISIONS = ["CONFIRMED", "CHANGES_REQUESTED"];
const VALID_EVIDENCE_TYPES = ["REPOSITORY", "LIVE_DEMO", "DOCUMENT", "IMAGE", "VIDEO", "OTHER"];

// ─────────────────────────────────────────────────────────────────────────────
// Shared params
// ─────────────────────────────────────────────────────────────────────────────

export const contributionParamRules = [
  param("projectId")
    .isString().trim().notEmpty().withMessage("projectId is required"),
  param("contributionId")
    .isString().trim().notEmpty().withMessage("contributionId is required"),
];

export const projectIdParamRule = [
  param("projectId")
    .isString().trim().notEmpty().withMessage("projectId is required"),
];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/contributions
// ─────────────────────────────────────────────────────────────────────────────

export const listContributionsRules = [
  ...projectIdParamRule,

  query("status")
    .optional()
    .isString().trim().toUpperCase()
    .isIn(VALID_STATUSES)
    .withMessage(`status must be one of: ${VALID_STATUSES.join(", ")}`),

  query("mine")
    .optional()
    .isBoolean({ strict: false })
    .withMessage("mine must be true or false")
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
// POST /api/projects/:projectId/contributions
// ─────────────────────────────────────────────────────────────────────────────

export const submitContributionRules = [
  ...projectIdParamRule,

  body("title")
    .isString().withMessage("title is required").bail()
    .trim()
    .isLength({ min: 1, max: 200 }).withMessage("title must be 1 to 200 characters"),

  body("description")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 5000 }).withMessage("description must be at most 5000 characters"),

  body("taskId")
    .optional({ values: "null" })
    .isString().trim().notEmpty()
    .withMessage("taskId must be a non-empty string"),

  body("artifactUrl")
    .optional({ values: "null" })
    .isString().trim()
    .isURL({ require_protocol: true })
    .withMessage("artifactUrl must be a valid URL"),

  body("fileUrl")
    .optional({ values: "null" })
    .isString().trim()
    .isURL({ require_protocol: true })
    .withMessage("fileUrl must be a valid URL"),

  body("fileType")
    .optional({ values: "null" })
    .isString().trim().toUpperCase()
    .isIn(VALID_EVIDENCE_TYPES)
    .withMessage(`fileType must be one of: ${VALID_EVIDENCE_TYPES.join(", ")}`),
];

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/contributions/:contributionId/review
// ─────────────────────────────────────────────────────────────────────────────

export const reviewContributionRules = [
  ...contributionParamRules,

  body("decision")
    .isString().withMessage("decision is required").bail()
    .trim().toUpperCase()
    .isIn(VALID_DECISIONS)
    .withMessage(`decision must be one of: ${VALID_DECISIONS.join(", ")}`),

  body("note")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 1000 }).withMessage("note must be at most 1000 characters"),
];

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/members/:memberId/release
// ─────────────────────────────────────────────────────────────────────────────

export const releaseMemberRules = [
  param("projectId")
    .isString().trim().notEmpty().withMessage("projectId is required"),
  param("memberId")
    .isString().trim().notEmpty().withMessage("memberId is required"),

  body("endReason")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 500 }).withMessage("endReason must be at most 500 characters"),
];

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/members/leave
// ─────────────────────────────────────────────────────────────────────────────

export const leaveProjectRules = [
  param("projectId")
    .isString().trim().notEmpty().withMessage("projectId is required"),

  body("reason")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 500 }).withMessage("reason must be at most 500 characters"),
];
