import { body, param, query } from "express-validator";

const VALID_STATUSES  = ["PENDING_REVIEW", "CONFIRMED", "CHANGES_REQUESTED"];
const VALID_DECISIONS = ["CONFIRMED", "CHANGES_REQUESTED"];

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
