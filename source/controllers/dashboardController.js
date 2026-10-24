import {
  getDashboardData,
  getRecommendedProjects,
  DashboardError,
} from "../services/dashboardService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared error handler — mirrors the pattern used in projectController.js
// ─────────────────────────────────────────────────────────────────────────────

function handleError(res, error) {
  if (error instanceof DashboardError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error("dashboard operation failed:", error);
  return res.status(500).json({ message: "Internal server error" });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/dashboard:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get the authenticated user's dashboard
 *     description: >
 *       Returns the full dashboard payload in a single call.
 *
 *       The `view` field tells the frontend which state to render:
 *         - `ONBOARDING`  — profile is incomplete; redirect to onboarding.
 *         - `PROJECTS`    — user has active projects; show workspace view.
 *         - `DISCOVERY`   — no active projects; show recommendations.
 *
 *       When `view` is `DISCOVERY`, `recommendedProjects` is populated.
 *       When `view` is `PROJECTS`, `ownedProjects` and `memberProjects`
 *       are populated alongside `attentionTasks`, `upcomingTasks`, and
 *       `pendingInvitations`.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:                 { type: object }
 *                 onboarding:           { type: object }
 *                 view:                 { type: string, enum: [ONBOARDING, PROJECTS, DISCOVERY] }
 *                 ownedProjects:        { type: array }
 *                 memberProjects:       { type: array }
 *                 attentionTasks:       { type: array }
 *                 upcomingTasks:        { type: array }
 *                 pendingInvitations:   { type: array }
 *                 recommendedProjects:  { type: array }
 *                 summary:              { type: object }
 *       401: { description: Authentication required }
 *       404: { description: User not found or inactive }
 *       500: { description: Internal server error }
 */
export async function GetDashboard(req, res) {
  try {
    const recommendationLimit = parseInt(req.query.recommendationLimit, 10) || 6;
    const data = await getDashboardData(req.user.id, { recommendationLimit });
    return res.status(200).json(data);
  } catch (error) {
    return handleError(res, error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/recommended
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/recommended:
 *   get:
 *     tags: [Projects]
 *     summary: Get personalised project recommendations for the user
 *     description: >
 *       Returns ranked OPEN projects with available roles that match the
 *       user's skills, availability, and duration preference.
 *       Each result includes a `recommendedRole` object explaining why
 *       the project was surfaced, and a `matchScore` (0–100).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 20, default: 6 }
 *     responses:
 *       200:
 *         description: Ranked project recommendations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 projects: { type: array }
 *       401: { description: Authentication required }
 *       404: { description: User not found or inactive }
 *       500: { description: Internal server error }
 */
export async function GetRecommendedProjects(req, res) {
  try {
    const limit = parseInt(req.query.limit, 10) || 6;
    // userContext is null here — getRecommendedProjects will fetch it internally
    const projects = await getRecommendedProjects(req.user.id, null, limit);
    return res.status(200).json({ projects });
  } catch (error) {
    return handleError(res, error);
  }
}
