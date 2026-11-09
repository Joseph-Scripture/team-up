import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { onboardingRules, updateProfileRules } from "../middleware/authMiddleware.js";
import { getMe, completeOnboarding, updateProfile } from "../controllers/profileController.js";
import { validate } from "../middleware/validateResults.js";
import { requireJson, rejectUnknownFields } from "../middleware/requestBody.js";
import { getSkills, getCategories } from "../controllers/skillController.js";
import { skillQueryRules } from "../middleware/skillMiddleware.js";
import {
  GetVisibilitySettings,
  UpdateVisibilitySettings,
  GetPublicProfile,
  GetCompletedProjects,
} from "../controllers/profileVisibilityController.js";
import {
  updateVisibilityRules,
  userIdParamRules,
  completedProjectsRules,
} from "../middleware/validateVisibility.js";

const router = Router();

/**
 * @openapi
 * /api/profile/skills/categories:
 *   get:
 *     tags: [Profile]
 *     summary: List all skill categories
 *     description: >
 *       Returns the distinct, sorted list of category names from the skill catalogue.
 *       Use this to populate the category picker in the onboarding flow, then call
 *       GET /api/profile/skills?category=<name> to load skills for the chosen category.
 *     responses:
 *       200:
 *         description: Sorted list of category names
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 categories:
 *                   type: array
 *                   items: { type: string }
 *                   example:
 *                     - "Business & Project Management"
 *                     - "Cloud, DevOps & Cybersecurity"
 *                     - "Data Analytics, Data Science & AI"
 *                     - "Digital Marketing & Content"
 *                     - "Graphic Design & Video Production"
 *                     - "Product Design (UI/UX)"
 *                     - "Product Management"
 *                     - "QA & Software Testing"
 *                     - "Software Development"
 *       500: { description: Internal server error }
 */
// NOTE: /categories must be declared BEFORE /skills so Express does not treat
// the literal string "categories" as a skill query with no filters.
router.get("/skills/categories", getCategories);

/**
 * @openapi
 * /api/profile/skills:
 *   get:
 *     tags: [Profile]
 *     summary: List available skills
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string, maxLength: 80 }
 *         description: Case-insensitive partial match on the skill name.
 *       - in: query
 *         name: category
 *         schema: { type: string, maxLength: 60 }
 *         description: Exact, case-insensitive category match.
 *     responses:
 *       200:
 *         description: Skills in the catalogue, ordered by category and name
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 skills:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       name: { type: string }
 *                       slug: { type: string }
 *                       category: { type: string, nullable: true }
 *       400: { description: Invalid query parameters }
 *       500: { description: Internal server error }
 */
router.get("/skills", skillQueryRules, validate, getSkills);

/**
 * @openapi
 * /api/profile/users/me:
 *   get:
 *     tags: [Profile]
 *     summary: Get the authenticated user's profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     name: { type: string }
 *                     email: { type: string, format: email }
 *                     role: { type: string, enum: [USER, ADMIN] }
 *                     headline: { type: string, nullable: true }
 *                     bio: { type: string, nullable: true }
 *                     goals: { type: string, nullable: true }
 *                     location: { type: string, nullable: true }
 *                     timezone: { type: string, nullable: true }
 *                     githubUrl: { type: string, nullable: true }
 *                     portfolioUrl: { type: string, nullable: true }
 *                     avatarUrl: { type: string, nullable: true }
 *                     weeklyAvailabilityHours: { type: integer, nullable: true }
 *                     preferredProjectDurationWeeks: { type: integer, nullable: true }
 *                     isAvailable: { type: boolean }
 *                     onboardingCompleted: { type: boolean }
 *                     skills:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           level: { type: string, enum: [BEGINNER, INTERMEDIATE, ADVANCED, EXPERT] }
 *                           skill:
 *                             type: object
 *                             properties:
 *                               id: { type: string }
 *                               name: { type: string }
 *                               slug: { type: string }
 *       401: { description: Missing, invalid, or expired token }
 *       404: { description: User not found }
 *       500: { description: Internal server error }
 */
router.get("/users/me", authenticate, getMe);

/**
 * @openapi
 * /api/profile/users/me:
 *   patch:
 *     tags: [Profile]
 *     summary: Update the authenticated user's profile
 *     description: >
 *       Partial update — send only the fields you want to change. All fields
 *       are optional. Skills, when provided, fully replace the current set.
 *
 *       **To update a profile picture:**
 *       1. Call `POST /api/uploads?context=avatar` as multipart/form-data
 *          with the image in the `file` field.
 *       2. Send the returned `fileUrl` as `avatarUrl` in this request body.
 *
 *       Send `avatarUrl: null` to remove the current picture. The old
 *       Cloudinary asset is deleted automatically.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:                         { type: string, maxLength: 100 }
 *               headline:                     { type: string, maxLength: 160, nullable: true }
 *               bio:                          { type: string, maxLength: 2000, nullable: true }
 *               goals:                        { type: string, maxLength: 2000, nullable: true }
 *               location:                     { type: string, maxLength: 120, nullable: true }
 *               timezone:                     { type: string, example: Africa/Douala, nullable: true }
 *               githubUrl:                    { type: string, format: uri, nullable: true }
 *               portfolioUrl:                 { type: string, format: uri, nullable: true }
 *               avatarUrl:
 *                 type: string
 *                 format: uri
 *                 nullable: true
 *                 description: Cloudinary fileUrl returned by POST /api/uploads?context=avatar
 *               weeklyAvailabilityHours:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 168
 *               preferredProjectDurationWeeks:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 52
 *               isAvailable:
 *                 type: boolean
 *               skills:
 *                 type: array
 *                 description: Replaces the full skill set when provided
 *                 minItems: 1
 *                 maxItems: 50
 *                 items:
 *                   type: object
 *                   required: [skillId, level]
 *                   properties:
 *                     skillId: { type: string }
 *                     level:
 *                       type: string
 *                       enum: [BEGINNER, INTERMEDIATE, ADVANCED, EXPERT]
 *     responses:
 *       200: { description: Profile updated, returns the full updated profile }
 *       400: { description: Validation error, unknown field, or unknown skill }
 *       401: { description: Authentication required }
 *       404: { description: User not found }
 *       415: { description: Content-Type must be application/json }
 */
router.patch(
  "/users/me",
  authenticate,
  requireJson,
  rejectUnknownFields([
    "name", "headline", "bio", "goals", "location", "timezone",
    "githubUrl", "portfolioUrl", "avatarUrl",
    "weeklyAvailabilityHours", "preferredProjectDurationWeeks",
    "isAvailable", "skills",
  ]),
  updateProfileRules,
  validate,
  updateProfile,
);

/**
 * @openapi
 * /api/profile/users/me/onboarding:
 *   put:
 *     tags: [Profile]
 *     summary: Complete the post-signup profile (goals, skills, availability, links)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [weeklyAvailabilityHours, goals, preferredProjectDurationWeeks, skills]
 *             properties:
 *               headline: { type: string, maxLength: 160 }
 *               bio: { type: string, maxLength: 2000 }
 *               location: { type: string, maxLength: 120 }
 *               timezone: { type: string, example: Africa/Douala }
 *               githubUrl: { type: string, format: uri }
 *               portfolioUrl: { type: string, format: uri }
 *               avatarUrl:
 *                 type: string
 *                 format: uri
 *                 nullable: true
 *                 description: Cloudinary fileUrl returned by POST /api/uploads?context=avatar
 *               weeklyAvailabilityHours: { type: integer, minimum: 0, maximum: 168, example: 15 }
 *               goals: { type: string, minLength: 1, maxLength: 2000, example: Practice defining requirements and coordinating a small product team. }
 *               preferredProjectDurationWeeks: { type: integer, minimum: 1, maximum: 52, example: 6 }
 *               isAvailable: { type: boolean, example: true }
 *               skills:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [skillId, level]
 *                   properties:
 *                     skillId: { type: string }
 *                     level: { type: string, enum: [BEGINNER, INTERMEDIATE, ADVANCED, EXPERT] }
 *     responses:
 *       200: { description: Profile saved }
 *       400: { description: Invalid input or unknown skill }
 *       401: { description: Missing, invalid or expired token }
 *       404: { description: User not found }
 *       500: { description: Internal server error }
 */
router.put("/users/me/onboarding", authenticate, onboardingRules, validate, completeOnboarding);

// ─────────────────────────────────────────────────────────────────────────────
// Visibility settings (owner only)
// NOTE: /users/me/visibility must be declared BEFORE /users/:userId so Express
// does not treat the literal "me" as a userId.
// ─────────────────────────────────────────────────────────────────────────────

router.get( "/users/me/visibility", authenticate, GetVisibilitySettings);
router.patch("/users/me/visibility", authenticate, updateVisibilityRules, validate, UpdateVisibilitySettings);

// ─────────────────────────────────────────────────────────────────────────────
// Public profile + completed projects (any authenticated user)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/users/:userId",                    authenticate, userIdParamRules,       validate, GetPublicProfile);
router.get("/users/:userId/completed-projects", authenticate, completedProjectsRules, validate, GetCompletedProjects);

export default router;