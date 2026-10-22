import { body } from "express-validator";

// ─────────────────────────────────────────────────────────────────────────────
// Shared constants
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_TYPES = [
  "WEB_APPLICATION",
  "MOBILE_APP",
  "DESKTOP_APP",
  "API_SERVICE",
  "DATA_SCIENCE",
  "DESIGN",
  "OTHER",
];

const SKILL_LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"];

// ─────────────────────────────────────────────────────────────────────────────
// Reusable field rules
// ─────────────────────────────────────────────────────────────────────────────

/** Fields always validated the same way regardless of draft vs publish. */
const sharedRules = [
  // ── Step 1: Project basics ───────────────────────────────────────────────
  body("title")
    .optional()
    .isString().withMessage("Title must be a string").bail()
    .trim()
    .isLength({ min: 1, max: 150 }).withMessage("Title must be 1 to 150 characters"),

  body("problem")
    .optional()
    .isString().withMessage("Problem must be a string").bail()
    .trim()
    .isLength({ max: 5000 }).withMessage("Problem must be at most 5000 characters"),

  body("description")
    .optional()
    .isString().withMessage("Description must be a string").bail()
    .trim()
    .isLength({ max: 5000 }).withMessage("Description must be at most 5000 characters"),

  body("projectType")
    .optional()
    .isIn(PROJECT_TYPES).withMessage(`projectType must be one of: ${PROJECT_TYPES.join(", ")}`),

  body("outcome")
    .optional()
    .isString().withMessage("Expected outcome must be a string").bail()
    .trim()
    .isLength({ max: 5000 }).withMessage("Outcome must be at most 5000 characters"),

  // ── Step 2: Roles ────────────────────────────────────────────────────────
  body("teamSize")
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage("Team size must be between 1 and 100").toInt(),

  body("roles")
    .optional()
    .isArray({ max: 20 }).withMessage("Roles must be an array of up to 20 items"),

  body("roles.*.title")
    .optional()
    .isString().withMessage("Role title must be a string").bail()
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage("Role title must be 1 to 100 characters"),

  body("roles.*.description")
    .optional()
    .isString().withMessage("Role responsibilities must be a string").bail()
    .trim()
    .isLength({ min: 1, max: 2000 }).withMessage("Role responsibilities must be 1 to 2000 characters"),

  body("roles.*.skills")
    .optional()
    .isArray({ max: 20 }).withMessage("Role skills must be an array of up to 20 items"),

  body("roles.*.skills.*.skillId")
    .optional()
    .isString().withMessage("skillId must be a string").bail()
    .trim()
    .notEmpty().withMessage("skillId is required"),

  body("roles.*.skills.*.minLevel")
    .optional()
    .isIn(SKILL_LEVELS).withMessage(`minLevel must be one of: ${SKILL_LEVELS.join(", ")}`),

  // ── Step 3: Commitment ───────────────────────────────────────────────────
  body("durationWeeks")
    .optional()
    .isInt({ min: 1, max: 52 }).withMessage("Duration must be between 1 and 52 weeks").toInt(),

  body("startDate")
    .optional()
    .isISO8601().withMessage("startDate must be a valid ISO 8601 date").toDate(),

  body("targetEndDate")
    .optional()
    .isISO8601().withMessage("targetEndDate must be a valid ISO 8601 date").toDate(),

  body("roles.*.hoursPerWeek")
    .optional()
    .isInt({ min: 1, max: 168 }).withMessage("Hours per week must be between 1 and 168").toInt(),

  body("availabilityExpectation")
    .optional()
    .isString().withMessage("Availability expectation must be a string").bail()
    .trim()
    .isLength({ max: 500 }).withMessage("Availability expectation must be at most 500 characters"),

  body("availabilityResponseExpectation")
    .optional()
    .isString().withMessage("Availability response expectation must be a string").bail()
    .trim()
    .isLength({ max: 500 }).withMessage("Availability response expectation must be at most 500 characters"),

  // ── Step 4: Milestones ───────────────────────────────────────────────────
  body("milestones")
    .optional()
    .isArray({ max: 20 }).withMessage("Milestones must be an array of up to 20 items"),

  body("milestones.*.title")
    .optional()
    .isString().withMessage("Milestone name must be a string").bail()
    .trim()
    .isLength({ min: 1, max: 150 }).withMessage("Milestone name must be 1 to 150 characters"),

  body("milestones.*.dueDate")
    .optional()
    .isISO8601().withMessage("Milestone target date must be a valid ISO 8601 date").toDate(),

  body("milestones.*.description")
    .optional()
    .isString().withMessage("Milestone description must be a string").bail()
    .trim()
    .isLength({ max: 2000 }).withMessage("Milestone description must be at most 2000 characters"),

  // ── Project-level skills (step 1) ────────────────────────────────────────
  body("skills")
    .optional()
    .isArray({ max: 30 }).withMessage("Project skills must be an array of up to 30 items"),

  body("skills.*.skillId")
    .optional()
    .isString().withMessage("skillId must be a string").bail()
    .trim()
    .notEmpty().withMessage("skillId is required"),

  body("skills.*.minLevel")
    .optional()
    .isIn(SKILL_LEVELS).withMessage(`minLevel must be one of: ${SKILL_LEVELS.join(", ")}`),
];

// ─────────────────────────────────────────────────────────────────────────────
// saveDraftRules — only title is required; everything else is optional.
// Used on every "Save draft" action at any step of the wizard.
// ─────────────────────────────────────────────────────────────────────────────
export const saveDraftRules = [
  body("title")
    .isString().withMessage("Title is required").bail()
    .trim()
    .isLength({ min: 1, max: 150 }).withMessage("Title must be 1 to 150 characters"),

  // All other fields are optional in a draft — use the shared optional rules,
  // but skip the title rule (already declared as required above).
  ...sharedRules.filter((rule) => {
    const fields = rule.builder?.fields ?? rule.fields ?? [];
    return !fields.includes("title");
  }),
];

// ─────────────────────────────────────────────────────────────────────────────
// publishRules — all fields required to transition DRAFT → OPEN.
// Applied by POST /api/projects/:id/publish.
// ─────────────────────────────────────────────────────────────────────────────
export const publishRules = [
  // ── Step 1: Project basics ───────────────────────────────────────────────
  body("title")
    .isString().withMessage("Title is required").bail()
    .trim()
    .isLength({ min: 1, max: 150 }).withMessage("Title must be 1 to 150 characters"),

  body("problem")
    .isString().withMessage("Problem or opportunity is required").bail()
    .trim()
    .isLength({ min: 1, max: 5000 }).withMessage("Problem must be 1 to 5000 characters"),

  body("description")
    .isString().withMessage("Description is required").bail()
    .trim()
    .isLength({ min: 1, max: 5000 }).withMessage("Description must be 1 to 5000 characters"),

  body("projectType")
    .isIn(PROJECT_TYPES).withMessage(`projectType is required and must be one of: ${PROJECT_TYPES.join(", ")}`),

  body("outcome")
    .isString().withMessage("Expected outcome is required").bail()
    .trim()
    .isLength({ min: 1, max: 5000 }).withMessage("Outcome must be 1 to 5000 characters"),

  body("skills")
    .isArray({ min: 1, max: 30 }).withMessage("At least one project-level skill is required"),

  body("skills.*.skillId")
    .isString().withMessage("skillId is required").bail()
    .trim()
    .notEmpty().withMessage("skillId must not be empty"),

  body("skills.*.minLevel")
    .optional()
    .isIn(SKILL_LEVELS).withMessage(`minLevel must be one of: ${SKILL_LEVELS.join(", ")}`),

  // ── Step 2: Roles ────────────────────────────────────────────────────────
  body("teamSize")
    .isInt({ min: 1, max: 100 }).withMessage("Team size is required and must be between 1 and 100").toInt(),

  body("roles")
    .isArray({ min: 1, max: 20 }).withMessage("At least one role is required"),

  body("roles.*.title")
    .isString().withMessage("Role title is required").bail()
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage("Role title must be 1 to 100 characters"),

  body("roles.*.description")
    .isString().withMessage("Role responsibilities are required").bail()
    .trim()
    .isLength({ min: 1, max: 2000 }).withMessage("Role responsibilities must be 1 to 2000 characters"),

  body("roles.*.skills")
    .isArray({ min: 1, max: 20 }).withMessage("Each role must have at least one required skill"),

  body("roles.*.skills.*.skillId")
    .isString().withMessage("skillId is required").bail()
    .trim()
    .notEmpty().withMessage("skillId must not be empty"),

  body("roles.*.skills.*.minLevel")
    .optional()
    .isIn(SKILL_LEVELS).withMessage(`minLevel must be one of: ${SKILL_LEVELS.join(", ")}`),

  // ── Step 3: Commitment ───────────────────────────────────────────────────
  body("durationWeeks")
    .isInt({ min: 1, max: 52 }).withMessage("Duration is required and must be between 1 and 52 weeks").toInt(),

  body("startDate")
    .isISO8601().withMessage("Planned start date is required").toDate(),

  body("targetEndDate")
    .isISO8601().withMessage("Planned end date is required").toDate(),

  body("roles.*.hoursPerWeek")
    .isInt({ min: 1, max: 168 }).withMessage("Hours per week is required for each role (1–168)").toInt(),

  body("availabilityExpectation")
    .isString().withMessage("Availability expectation is required").bail()
    .trim()
    .isLength({ min: 1, max: 500 }).withMessage("Availability expectation must be 1 to 500 characters"),

  body("availabilityResponseExpectation")
    .isString().withMessage("Availability and response expectation is required").bail()
    .trim()
    .isLength({ min: 1, max: 500 }).withMessage("Availability response expectation must be 1 to 500 characters"),

  // ── Step 4: Milestones ───────────────────────────────────────────────────
  body("milestones")
    .isArray({ min: 1, max: 20 }).withMessage("At least one milestone is required"),

  body("milestones.*.title")
    .isString().withMessage("Milestone name is required").bail()
    .trim()
    .isLength({ min: 1, max: 150 }).withMessage("Milestone name must be 1 to 150 characters"),

  body("milestones.*.dueDate")
    .isISO8601().withMessage("Milestone target date is required").toDate(),

  body("milestones.*.description")
    .optional()
    .isString().withMessage("Milestone description must be a string").bail()
    .trim()
    .isLength({ max: 2000 }).withMessage("Milestone description must be at most 2000 characters"),
];
