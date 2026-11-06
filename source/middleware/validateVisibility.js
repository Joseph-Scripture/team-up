import { body, param, query } from "express-validator";

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/profile/users/me/visibility
// ─────────────────────────────────────────────────────────────────────────────

export const updateVisibilityRules = [
  body("showName")
    .optional()
    .isBoolean({ strict: false }).withMessage("showName must be true or false")
    .toBoolean(),

  body("showHeadline")
    .optional()
    .isBoolean({ strict: false }).withMessage("showHeadline must be true or false")
    .toBoolean(),

  body("showSkills")
    .optional()
    .isBoolean({ strict: false }).withMessage("showSkills must be true or false")
    .toBoolean(),

  body("showSkillLevels")
    .optional()
    .isBoolean({ strict: false }).withMessage("showSkillLevels must be true or false")
    .toBoolean(),

  body("showGoals")
    .optional()
    .isBoolean({ strict: false }).withMessage("showGoals must be true or false")
    .toBoolean(),

  body("showAvailability")
    .optional()
    .isBoolean({ strict: false }).withMessage("showAvailability must be true or false")
    .toBoolean(),

  body("showPreferredDuration")
    .optional()
    .isBoolean({ strict: false }).withMessage("showPreferredDuration must be true or false")
    .toBoolean(),
];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/profile/users/:userId
// GET /api/profile/users/:userId/completed-projects
// ─────────────────────────────────────────────────────────────────────────────

export const userIdParamRules = [
  param("userId")
    .isString().trim().notEmpty()
    .withMessage("userId is required"),
];

export const completedProjectsRules = [
  ...userIdParamRules,

  query("page")
    .optional()
    .isInt({ min: 1 }).withMessage("page must be a positive integer")
    .toInt(),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 50 }).withMessage("limit must be between 1 and 50")
    .toInt(),
];
