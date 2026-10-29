import { body, param, query } from "express-validator";

const INVITATION_STATUSES = ["PENDING", "ACCEPTED", "DECLINED", "CANCELLED", "EXPIRED"];

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/invitations
// ─────────────────────────────────────────────────────────────────────────────

export const sendInvitationRules = [
  param("projectId")
    .isString().trim().notEmpty()
    .withMessage("projectId is required"),

  body("inviteeId")
    .isString().withMessage("inviteeId is required").bail()
    .trim().notEmpty().withMessage("inviteeId must not be empty"),

  body("roleId")
    .isString().withMessage("roleId is required").bail()
    .trim().notEmpty().withMessage("roleId must not be empty"),

  body("message")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 500 }).withMessage("Message must be at most 500 characters"),

  body("proposedHoursPerWeek")
    .optional({ values: "null" })
    .isInt({ min: 1, max: 168 }).withMessage("proposedHoursPerWeek must be between 1 and 168")
    .toInt(),
];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/invitations
// ─────────────────────────────────────────────────────────────────────────────

export const listProjectInvitationsRules = [
  param("projectId")
    .isString().trim().notEmpty()
    .withMessage("projectId is required"),

  query("status")
    .optional()
    .isString().trim()
    .toUpperCase()
    .isIn(INVITATION_STATUSES)
    .withMessage(`status must be one of: ${INVITATION_STATUSES.join(", ")}`),

  query("roleId")
    .optional()
    .isString().trim().notEmpty()
    .withMessage("roleId must not be empty if provided"),

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
// GET /api/invitations  (my received invitations)
// ─────────────────────────────────────────────────────────────────────────────

export const listMyInvitationsRules = [
  query("status")
    .optional()
    .isString().trim()
    .toUpperCase()
    .isIn(INVITATION_STATUSES)
    .withMessage(`status must be one of: ${INVITATION_STATUSES.join(", ")}`),

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
// POST /api/invitations/:invitationId/accept|decline
// ─────────────────────────────────────────────────────────────────────────────

export const invitationIdParamRules = [
  param("invitationId")
    .isString().trim().notEmpty()
    .withMessage("invitationId is required"),
];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/collaborators
// ─────────────────────────────────────────────────────────────────────────────

const VALID_PROJECT_TYPES = [
  "WEB_APPLICATION",
  "MOBILE_APP",
  "DESKTOP_APP",
  "API_SERVICE",
  "DATA_SCIENCE",
  "DESIGN",
  "OTHER",
];

export const findCollaboratorsRules = [
  param("projectId")
    .isString().trim().notEmpty()
    .withMessage("projectId is required"),

  // roleId is required — the UI always selects a role before applying filters
  query("roleId")
    .isString().withMessage("roleId is required").bail()
    .trim().notEmpty().withMessage("roleId must not be empty"),

  // Optional: one or more skill IDs (supports ?skills[]=id1&skills[]=id2)
  query("skills")
    .optional()
    .toArray()
    .isArray({ max: 20 }).withMessage("skills must be an array of up to 20 IDs")
    .custom((arr) => arr.every((v) => typeof v === "string" && v.trim().length > 0))
    .withMessage("each skill entry must be a non-empty string"),

  // Optional: projectType enum filter
  query("projectType")
    .optional()
    .isString().trim()
    .toUpperCase()
    .isIn(VALID_PROJECT_TYPES)
    .withMessage(`projectType must be one of: ${VALID_PROJECT_TYPES.join(", ")}`),

  // Optional: target project duration in weeks (integer 1–52)
  query("durationWeeks")
    .optional()
    .isInt({ min: 1, max: 52 }).withMessage("durationWeeks must be an integer between 1 and 52")
    .toInt(),

  // Optional: required weekly hours for the role (integer 1–168)
  query("weeklyHours")
    .optional()
    .isInt({ min: 1, max: 168 }).withMessage("weeklyHours must be an integer between 1 and 168")
    .toInt(),

  query("page")
    .optional()
    .isInt({ min: 1 }).withMessage("page must be a positive integer")
    .toInt(),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 50 }).withMessage("limit must be between 1 and 50")
    .toInt(),
];
