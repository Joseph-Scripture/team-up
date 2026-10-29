import { body, param } from "express-validator";

const VALID_MILESTONE_STATUSES = ["TODO", "IN_PROGRESS", "COMPLETED"];

export const createMilestoneRules = [
  param("projectId").isString().trim().notEmpty().withMessage("projectId is required"),

  body("title")
    .isString().withMessage("title is required").bail()
    .trim().notEmpty().withMessage("title must not be empty")
    .isLength({ max: 150 }).withMessage("title must be at most 150 characters"),

  body("description")
    .optional({ values: "null" })
    .isString().trim()
    .isLength({ max: 2000 }).withMessage("description must be at most 2000 characters"),

  body("dueDate")
    .optional({ values: "null" })
    .isISO8601().withMessage("dueDate must be a valid ISO 8601 date")
    .toDate(),

  body("sortOrder")
    .optional()
    .isInt({ min: 0 }).withMessage("sortOrder must be a non-negative integer")
    .toInt(),
];

export const updateMilestoneRules = [
  param("projectId").isString().trim().notEmpty().withMessage("projectId is required"),
  param("milestoneId").isString().trim().notEmpty().withMessage("milestoneId is required"),

  body("title")
    .optional()
    .isString().trim()
    .notEmpty().withMessage("title must not be empty")
    .isLength({ max: 150 }).withMessage("title must be at most 150 characters"),

  body("description")
    .optional({ values: "null" })
    .isString().trim(),

  body("dueDate")
    .optional({ values: "null" })
    .isISO8601().withMessage("dueDate must be a valid ISO 8601 date")
    .toDate(),

  body("status")
    .optional()
    .isString().trim().toUpperCase()
    .isIn(VALID_MILESTONE_STATUSES)
    .withMessage(`status must be one of: ${VALID_MILESTONE_STATUSES.join(", ")}`),

  body("sortOrder")
    .optional()
    .isInt({ min: 0 }).withMessage("sortOrder must be a non-negative integer")
    .toInt(),
];

export const milestoneParamRules = [
  param("projectId").isString().trim().notEmpty().withMessage("projectId is required"),
  param("milestoneId").isString().trim().notEmpty().withMessage("milestoneId is required"),
];
