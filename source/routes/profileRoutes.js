import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { onboardingRules,  } from "../middleware/authMiddleware.js";
import { getMe, completeOnboarding } from "../controllers/profileController.js";
import { validate } from "../middleware/validateResults.js";
import { listSkills } from "../services/skills.js";

const router = Router();

/**
 * @openapi
 * /api/profile/skills:
 *   get:
 *     tags: [Profile]
 *     summary: List available skills
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
 *       500: { description: Internal server error }
 */
router.get("/skills", listSkills);

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
 *                     location: { type: string, nullable: true }
 *                     timezone: { type: string, nullable: true }
 *                     githubUrl: { type: string, nullable: true }
 *                     portfolioUrl: { type: string, nullable: true }
 *                     avatarUrl: { type: string, nullable: true }
 *                     weeklyAvailabilityHours: { type: integer, nullable: true }
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
 * /api/profile/users/me/onboarding:
 *   put:
 *     tags: [Profile]
 *     summary: Complete the post-signup profile (skills, availability, links)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [weeklyAvailabilityHours, skills]
 *             properties:
 *               headline: { type: string, maxLength: 160 }
 *               bio: { type: string, maxLength: 2000 }
 *               location: { type: string, maxLength: 120 }
 *               timezone: { type: string, example: Africa/Douala }
 *               githubUrl: { type: string, format: uri }
 *               portfolioUrl: { type: string, format: uri }
 *               weeklyAvailabilityHours: { type: integer, minimum: 0, maximum: 168, example: 15 }
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

export default router;