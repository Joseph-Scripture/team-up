
import { body } from "express-validator";



const maxBytes72 = (value) => Buffer.byteLength(value, "utf8") <= 72; // bcrypt ignores anything past 72 bytes

export const signupRules = [
  body("username")
    .isString().withMessage("Username is required").bail()
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage("Username must be 1 to 100 characters"),
  body("email")
    .isString().withMessage("Email is required").bail()
    .trim()
    .toLowerCase()
    .isEmail().withMessage("Invalid email address")
    .isLength({ max: 255 }).withMessage("Email is too long"),
  body("password")
    .isString().withMessage("Password is required").bail()
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters")
    .custom(maxBytes72).withMessage("Password must be at most 72 bytes"),
];

export const loginRules = [
  body("email")
    .isString().withMessage("Email is required").bail()
    .trim()
    .toLowerCase()
    .notEmpty().withMessage("Email is required"),
  body("password")
    .isString().withMessage("Password is required").bail()
    .notEmpty().withMessage("Password is required"),
];

const LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"];
const isValidTimezone = (tz) => {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
};
const url = { protocols: ["http", "https"], require_protocol: true };

export const onboardingRules = [
  body("headline").optional({ values: "null" }).isString().trim().isLength({ max: 160 }),
  body("bio").optional({ values: "null" }).isString().trim().isLength({ max: 2000 }),
  body("location").optional({ values: "null" }).isString().trim().isLength({ max: 120 }),
  body("timezone").optional({ values: "null" }).isString().trim().custom(isValidTimezone)
    .withMessage("Invalid IANA timezone, e.g. Africa/Douala"),
  body("githubUrl").optional({ values: "null" }).isString().trim().isLength({ max: 2048 }).isURL(url)
    .withMessage("Enter a full URL starting with http:// or https://"),
  body("portfolioUrl").optional({ values: "null" }).isString().trim().isLength({ max: 2048 }).isURL(url)
    .withMessage("Enter a full URL starting with http:// or https://"),
  body("weeklyAvailabilityHours").isInt({ min: 0, max: 168 }).withMessage("Must be 0 to 168").toInt(),
  body("goals")
    .isString().withMessage("Goals are required").bail()
    .trim()
    .isLength({ min: 1, max: 2000 }).withMessage("Goals must be 1 to 2000 characters"),
  body("preferredProjectDurationWeeks")
    .isInt({ min: 1, max: 52 }).withMessage("Must be 1 to 52 weeks").toInt(),
  body("isAvailable").optional().isBoolean({ strict: true }).withMessage("Must be true or false").toBoolean(),
  body("skills").isArray({ min: 1, max: 50 }).withMessage("Select 1 to 50 skills"),
  body("skills.*.skillId").isString().trim().notEmpty().withMessage("skillId is required"),
  body("skills.*.level").isIn(LEVELS).withMessage(`level must be one of ${LEVELS.join(", ")}`),
];