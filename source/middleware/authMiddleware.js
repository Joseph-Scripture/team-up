import { body } from "express-validator";
import config from "../../config.js";

const maxBytes72 = (value) => Buffer.byteLength(value, "utf8") <= 72; // bcrypt ignores anything past 72 bytes

const passwordStrengthRules = (field) => [
  body(field)
    .isString().withMessage("Password is required").bail()
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters")
    .custom(maxBytes72).withMessage("Password must be at most 72 bytes")
    .matches(/[A-Za-z]/).withMessage("Password must contain at least one letter")
    .matches(/[A-Z]/).withMessage("Password must contain at least one uppercase letter")
    .matches(/[^A-Za-z0-9\s]/).withMessage("Password must contain at least one special character"),
];

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
  ...passwordStrengthRules("password"),
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

export const forgotPasswordRules = [
  body("email")
    .isString().withMessage("Email is required").bail()
    .trim()
    .toLowerCase()
    .isEmail().withMessage("Invalid email address")
    .isLength({ max: 255 }).withMessage("Email is too long"),
];

export const resetPasswordRules = [
  body("token")
    .isString().withMessage("Reset token is required").bail()
    .trim()
    .isLength({ min: 32, max: 200 }).withMessage("Invalid reset token"),
  ...passwordStrengthRules("password"),
];

const LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"];
const isValidTimezone = (tz) => {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
};

const isHttpUrl = (value) => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
};

const isOurCloudinaryUrl = (value) => {
  if (!isHttpUrl(value)) return false;
  const url = new URL(value);
  return url.hostname === "res.cloudinary.com"
    && url.pathname.startsWith(`/${config.CLOUDINARY_CLOUD_NAME}/image/upload/`);
};

const trimOrNull = (value) => (typeof value === "string" ? value.trim() : value);

// Nullable string field. Unlike optional({ values: "null" }), this keeps null
// in matchedData so the service can actually clear the column.
const nullableString = (field, { min = 0, max, message }) =>
  body(field)
    .optional({ values: "undefined" })
    .customSanitizer(trimOrNull)
    .custom((value) => value === null || (
      typeof value === "string" && value.length >= min && value.length <= max
    ))
    .withMessage(message);

const nullableUrl = (field, { cloudinaryOnly = false } = {}) =>
  body(field)
    .optional({ values: "undefined" })
    .customSanitizer(trimOrNull)
    .custom((value) => value === null || (
      cloudinaryOnly ? isOurCloudinaryUrl(value) : isHttpUrl(value)
    ))
    .withMessage(
      cloudinaryOnly
        ? `${field} must be a Cloudinary URL for this application`
        : `${field} must be a valid URL starting with http:// or https://`,
    );

const nullableTimezone = (field) =>
  body(field)
    .optional({ values: "undefined" })
    .customSanitizer(trimOrNull)
    .custom((value) => value === null || (typeof value === "string" && isValidTimezone(value)))
    .withMessage("Invalid IANA timezone, e.g. Africa/Douala");

export const onboardingRules = [
  nullableString("headline", { max: 160, message: "Headline must be at most 160 characters" }),
  nullableString("bio", { max: 2000, message: "Bio must be at most 2000 characters" }),
  nullableString("location", { max: 120, message: "Location must be at most 120 characters" }),
  nullableTimezone("timezone"),
  nullableUrl("githubUrl"),
  nullableUrl("portfolioUrl"),
  nullableUrl("avatarUrl", { cloudinaryOnly: true }),
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

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/profile/users/me  — partial profile update
// Every field is optional. avatarUrl accepts a Cloudinary image URL.
// ─────────────────────────────────────────────────────────────────────────────

export const updateProfileRules = [
  body("name")
    .optional()
    .isString().trim()
    .isLength({ min: 1, max: 100 }).withMessage("Name must be 1 to 100 characters"),

  nullableString("headline", { max: 160, message: "Headline must be at most 160 characters" }),
  nullableString("bio", { max: 2000, message: "Bio must be at most 2000 characters" }),
  nullableString("goals", { min: 1, max: 2000, message: "Goals must be 1 to 2000 characters" }),
  nullableString("location", { max: 120, message: "Location must be at most 120 characters" }),
  nullableTimezone("timezone"),
  nullableUrl("githubUrl"),
  nullableUrl("portfolioUrl"),
  nullableUrl("avatarUrl", { cloudinaryOnly: true }),

  body("weeklyAvailabilityHours")
    .optional()
    .isInt({ min: 0, max: 168 }).withMessage("Must be 0 to 168")
    .toInt(),

  body("preferredProjectDurationWeeks")
    .optional()
    .isInt({ min: 1, max: 52 }).withMessage("Must be 1 to 52 weeks")
    .toInt(),

  body("isAvailable")
    .optional()
    .isBoolean({ strict: true }).withMessage("Must be true or false")
    .toBoolean(),

  // Skills are optional — if provided they fully replace the current set.
  body("skills")
    .optional()
    .isArray({ min: 1, max: 50 }).withMessage("skills must be an array of 1 to 50 items"),

  body("skills.*.skillId")
    .isString().trim().notEmpty().withMessage("skillId is required"),

  body("skills.*.level")
    .isIn(LEVELS).withMessage(`level must be one of ${LEVELS.join(", ")}`),
];
