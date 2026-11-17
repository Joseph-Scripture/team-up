import { body, param } from "express-validator";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/evidence
// ─────────────────────────────────────────────────────────────────────────────

const VALID_EVIDENCE_TYPES = ["REPOSITORY", "LIVE_DEMO", "DOCUMENT", "IMAGE", "VIDEO", "OTHER"];

export const addEvidenceRules = [
  param("projectId")
    .isString().trim().notEmpty().withMessage("projectId is required"),

  body("title")
    .isString().withMessage("title is required").bail()
    .trim()
    .isLength({ min: 1, max: 150 }).withMessage("title must be 1 to 150 characters"),

  body("description")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 2000 }).withMessage("description must be at most 2000 characters"),

  body("url")
    .isString().withMessage("url is required").bail()
    .trim()
    .isURL({ require_protocol: true })
    .withMessage("url must be a valid URL"),

  body("type")
    .optional({ values: "null" })
    .isString().trim().toUpperCase()
    .isIn(VALID_EVIDENCE_TYPES)
    .withMessage(`type must be one of: ${VALID_EVIDENCE_TYPES.join(", ")}`),
];

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/projects/:projectId/evidence/:evidenceId
// All body fields are optional (patch semantics).
// ─────────────────────────────────────────────────────────────────────────────

export const updateEvidenceRules = [
  param("projectId")
    .isString().trim().notEmpty().withMessage("projectId is required"),
  param("evidenceId")
    .isString().trim().notEmpty().withMessage("evidenceId is required"),

  body("title")
    .optional()
    .isString().trim()
    .isLength({ min: 1, max: 150 }).withMessage("title must be 1 to 150 characters"),

  body("description")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 2000 }).withMessage("description must be at most 2000 characters"),

  body("url")
    .optional()
    .isString().trim()
    .isURL({ require_protocol: true })
    .withMessage("url must be a valid URL"),

  body("type")
    .optional({ values: "null" })
    .isString().trim().toUpperCase()
    .isIn(VALID_EVIDENCE_TYPES)
    .withMessage(`type must be one of: ${VALID_EVIDENCE_TYPES.join(", ")}`),
];

export const evidenceParamRules = [
  param("projectId")
    .isString().trim().notEmpty().withMessage("projectId is required"),
  param("evidenceId")
    .isString().trim().notEmpty().withMessage("evidenceId is required"),
];

// Listing only needs the project.
export const projectEvidenceRules = [
  param("projectId")
    .isString().trim().notEmpty().withMessage("projectId is required"),
];
