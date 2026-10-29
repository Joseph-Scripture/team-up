import { body, param, query } from "express-validator";

const VALID_STATUSES   = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "COMPLETED", "CANCELLED"];
const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

// ─────────────────────────────────────────────────────────────────────────────
// Shared params
// ─────────────────────────────────────────────────────────────────────────────

const projectIdParam = param("projectId")
  .isString().trim().notEmpty().withMessage("projectId is required");

const taskIdParam = param("taskId")
  .isString().trim().notEmpty().withMessage("taskId is required");

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/tasks
// ─────────────────────────────────────────────────────────────────────────────

export const createTaskRules = [
  projectIdParam,

  body("title")
    .isString().withMessage("title is required").bail()
    .trim().notEmpty().withMessage("title must not be empty")
    .isLength({ max: 200 }).withMessage("title must be at most 200 characters"),

  body("assigneeMemberId")
    .isString().withMessage("assigneeMemberId is required").bail()
    .trim().notEmpty().withMessage("assigneeMemberId must not be empty"),

  body("dueDate")
    .isISO8601().withMessage("dueDate is required and must be a valid ISO 8601 date")
    .toDate(),

  body("milestoneId")
    .isString().withMessage("milestoneId is required").bail()
    .trim().notEmpty().withMessage("milestoneId must not be empty"),

  body("description")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 5000 }).withMessage("description must be at most 5000 characters"),

  body("status")
    .optional()
    .isString().trim().toUpperCase()
    .isIn(VALID_STATUSES)
    .withMessage(`status must be one of: ${VALID_STATUSES.join(", ")}`),

  body("priority")
    .optional()
    .isString().trim().toUpperCase()
    .isIn(VALID_PRIORITIES)
    .withMessage(`priority must be one of: ${VALID_PRIORITIES.join(", ")}`),

  body("estimatedHours")
    .optional({ values: "null" })
    .isInt({ min: 1 }).withMessage("estimatedHours must be a positive integer")
    .toInt(),

  body("sortOrder")
    .optional()
    .isInt({ min: 0 }).withMessage("sortOrder must be a non-negative integer")
    .toInt(),
];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/tasks
// ─────────────────────────────────────────────────────────────────────────────

export const listTasksRules = [
  projectIdParam,

  query("status")
    .optional()
    .isString().trim().toUpperCase()
    .isIn(VALID_STATUSES)
    .withMessage(`status must be one of: ${VALID_STATUSES.join(", ")}`),

  query("milestoneId")
    .optional()
    .isString().trim().notEmpty(),

  query("assigneeMemberId")
    .optional()
    .isString().trim().notEmpty(),

  query("mine")
    .optional()
    .isBoolean({ strict: false }).withMessage("mine must be true or false")
    .toBoolean(),

  query("page")
    .optional()
    .isInt({ min: 1 }).withMessage("page must be a positive integer")
    .toInt(),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage("limit must be between 1 and 100")
    .toInt(),
];

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/projects/:projectId/tasks/:taskId
// ─────────────────────────────────────────────────────────────────────────────

export const updateTaskRules = [
  projectIdParam,
  taskIdParam,

  body("title")
    .optional()
    .isString().trim()
    .notEmpty().withMessage("title must not be empty")
    .isLength({ max: 200 }).withMessage("title must be at most 200 characters"),

  body("description")
    .optional({ values: "null" })
    .isString().trim(),

  body("assigneeMemberId")
    .optional({ values: "null" })
    .isString().trim(),

  body("milestoneId")
    .optional({ values: "null" })
    .isString().trim(),

  body("dueDate")
    .optional({ values: "null" })
    .isISO8601().withMessage("dueDate must be a valid ISO 8601 date")
    .toDate(),

  body("status")
    .optional()
    .isString().trim().toUpperCase()
    .isIn(VALID_STATUSES)
    .withMessage(`status must be one of: ${VALID_STATUSES.join(", ")}`),

  body("priority")
    .optional()
    .isString().trim().toUpperCase()
    .isIn(VALID_PRIORITIES)
    .withMessage(`priority must be one of: ${VALID_PRIORITIES.join(", ")}`),

  body("blockerNote")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 1000 }).withMessage("blockerNote must be at most 1000 characters"),

  body("estimatedHours")
    .optional({ values: "null" })
    .isInt({ min: 1 }).withMessage("estimatedHours must be a positive integer")
    .toInt(),

  body("sortOrder")
    .optional()
    .isInt({ min: 0 }).withMessage("sortOrder must be a non-negative integer")
    .toInt(),

  // Contribution sub-object (only meaningful when status = COMPLETED)
  body("contribution")
    .optional({ values: "null" })
    .isObject().withMessage("contribution must be an object"),

  body("contribution.title")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 200 }).withMessage("contribution title must be at most 200 characters"),

  body("contribution.completionNote")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 2000 }).withMessage("completionNote must be at most 2000 characters"),

  body("contribution.artifactUrl")
    .optional({ values: "null" })
    .isURL().withMessage("artifactUrl must be a valid URL"),

  body("contribution.fileUrl")
    .optional({ values: "null" })
    .isURL().withMessage("fileUrl must be a valid URL"),

  body("contribution.fileType")
    .optional({ values: "null" })
    .isString().trim()
    .isIn(["REPOSITORY", "LIVE_DEMO", "DOCUMENT", "IMAGE", "VIDEO", "OTHER"])
    .withMessage("fileType must be a valid EvidenceType"),
];

// ─────────────────────────────────────────────────────────────────────────────
// Task + comment param rules
// ─────────────────────────────────────────────────────────────────────────────

export const taskParamRules = [projectIdParam, taskIdParam];

export const commentParamRules = [
  projectIdParam,
  taskIdParam,
  param("commentId").isString().trim().notEmpty().withMessage("commentId is required"),
];

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/tasks/:taskId/comments
// ─────────────────────────────────────────────────────────────────────────────

export const createCommentRules = [
  projectIdParam,
  taskIdParam,

  body("content")
    .isString().withMessage("content is required").bail()
    .trim().notEmpty().withMessage("content must not be empty")
    .isLength({ max: 3000 }).withMessage("content must be at most 3000 characters"),
];

export const updateCommentRules = [
  ...commentParamRules,

  body("content")
    .isString().withMessage("content is required").bail()
    .trim().notEmpty().withMessage("content must not be empty")
    .isLength({ max: 3000 }).withMessage("content must be at most 3000 characters"),
];

// ─────────────────────────────────────────────────────────────────────────────
// Team updates
// ─────────────────────────────────────────────────────────────────────────────

export const createTeamUpdateRules = [
  projectIdParam,

  body("content")
    .isString().withMessage("content is required").bail()
    .trim().notEmpty().withMessage("content must not be empty")
    .isLength({ max: 5000 }).withMessage("content must be at most 5000 characters"),
];
