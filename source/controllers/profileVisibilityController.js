import { matchedData } from "express-validator";
import {
  getVisibilitySettings,
  updateVisibilitySettings,
  getPublicProfile,
  getCompletedProjects,
  VisibilityError,
} from "../services/profileVisibilityService.js";

function handleError(res, error) {
  if (error instanceof VisibilityError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error("profile visibility operation failed:", error);
  return res.status(500).json({ message: "Internal server error" });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/profile/users/me/visibility
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/profile/users/me/visibility:
 *   get:
 *     tags: [Profile]
 *     summary: Get the authenticated user's visibility settings
 *     description: >
 *       Returns the current visibility settings. If the user has never saved
 *       preferences, the defaults are returned (all fields public).
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current visibility settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 visibility:
 *                   type: object
 *                   properties:
 *                     showName:              { type: boolean }
 *                     showHeadline:          { type: boolean }
 *                     showSkills:            { type: boolean }
 *                     showSkillLevels:       { type: boolean }
 *                     showGoals:             { type: boolean }
 *                     showAvailability:      { type: boolean }
 *                     showPreferredDuration: { type: boolean }
 */
export async function GetVisibilitySettings(req, res) {
  try {
    const visibility = await getVisibilitySettings(req.userId);
    return res.status(200).json({ visibility });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/profile/users/me/visibility
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/profile/users/me/visibility:
 *   patch:
 *     tags: [Profile]
 *     summary: Update the authenticated user's visibility settings
 *     description: >
 *       Partial update — send only the flags you want to change. Unspecified
 *       flags keep their current value. All flags default to true (public).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               showName:              { type: boolean }
 *               showHeadline:          { type: boolean }
 *               showSkills:            { type: boolean }
 *               showSkillLevels:       { type: boolean }
 *               showGoals:             { type: boolean }
 *               showAvailability:      { type: boolean }
 *               showPreferredDuration: { type: boolean }
 *     responses:
 *       200: { description: Updated visibility settings }
 *       400: { description: Validation error }
 */
export async function UpdateVisibilitySettings(req, res) {
  try {
    const body       = matchedData(req, { locations: ["body"] });
    const visibility = await updateVisibilitySettings(req.userId, body);
    return res.status(200).json({ message: "Visibility settings saved.", visibility });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/profile/users/:userId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/profile/users/{userId}:
 *   get:
 *     tags: [Profile]
 *     summary: Get a user's public profile
 *     description: >
 *       Returns the user's profile filtered by their visibility settings.
 *       Fields the user has hidden are omitted from the response entirely.
 *       The owner always sees their own full profile. Contact details (email)
 *       are never included.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Public profile (visibility-filtered)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 profile:
 *                   type: object
 *                   properties:
 *                     id:                          { type: string }
 *                     avatarUrl:                   { type: string, nullable: true }
 *                     name:                        { type: string, description: "Present if showName = true" }
 *                     headline:                    { type: string, nullable: true }
 *                     goals:                       { type: string, nullable: true }
 *                     isAvailable:                 { type: boolean }
 *                     weeklyAvailabilityHours:     { type: integer, nullable: true }
 *                     preferredProjectDurationWeeks: { type: integer, nullable: true }
 *                     skills:                      { type: array }
 *                     isOwnProfile:                { type: boolean }
 *       401: { description: Authentication required }
 *       404: { description: User not found }
 */
export async function GetPublicProfile(req, res) {
  try {
    const { userId } = matchedData(req, { locations: ["params"] });
    const profile    = await getPublicProfile(userId, req.userId);
    return res.status(200).json({ profile });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/profile/users/:userId/completed-projects
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/profile/users/{userId}/completed-projects:
 *   get:
 *     tags: [Profile]
 *     summary: Get a user's completed projects (portfolio)
 *     description: >
 *       Returns paginated completed projects where the user is either the owner
 *       or a past/active member. Always visible regardless of visibility settings.
 *       Includes the user's role, membership dates, and confirmed contributions
 *       on each project.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 10 }
 *     responses:
 *       200:
 *         description: Paginated completed projects
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:       { type: object }
 *                 projects:   { type: array }
 *                 pagination: { type: object }
 *       401: { description: Authentication required }
 *       404: { description: User not found }
 */
export async function GetCompletedProjects(req, res) {
  try {
    const { userId }  = matchedData(req, { locations: ["params"] });
    const filters     = matchedData(req, { locations: ["query"] });
    const result      = await getCompletedProjects(userId, filters);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}
