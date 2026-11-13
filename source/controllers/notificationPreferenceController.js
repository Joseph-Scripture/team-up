import { matchedData } from "express-validator";
import {
  getPreferences,
  updatePreferences,
  PreferenceError,
} from "../services/notificationPreferenceService.js";

function handleError(res, error) {
  if (error instanceof PreferenceError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error("notification preference operation failed:", error);
  return res.status(500).json({ message: "Internal server error" });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications/preferences
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/notifications/preferences:
 *   get:
 *     tags: [Notifications]
 *     summary: Get notification preferences
 *     description: >
 *       Returns the full preference matrix for the authenticated user — one
 *       entry for every notification type × channel combination (28 rows total:
 *       14 types × 2 channels). Rows that have never been explicitly set default
 *       to enabled: true.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Full preference matrix
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 preferences:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       type:    { type: string }
 *                       channel: { type: string, enum: [IN_APP, EMAIL] }
 *                       enabled: { type: boolean }
 *       401: { description: Authentication required }
 */
export async function GetPreferences(req, res) {
  try {
    const preferences = await getPreferences(req.userId);
    return res.status(200).json({ preferences });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/notifications/preferences
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/notifications/preferences:
 *   put:
 *     tags: [Notifications]
 *     summary: Update notification preferences
 *     description: >
 *       Upserts one or more notification preferences. Only the combinations
 *       included in the request body are updated — all others remain unchanged.
 *       Returns the full updated preference matrix.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [preferences]
 *             properties:
 *               preferences:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [type, channel, enabled]
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum:
 *                         - PROJECT_INVITATION
 *                         - INVITATION_RESPONDED
 *                         - JOIN_REQUEST
 *                         - JOIN_REQUEST_DECIDED
 *                         - MEMBER_JOINED
 *                         - MEMBER_LEFT
 *                         - TASK_ASSIGNED
 *                         - TASK_COMMENTED
 *                         - TASK_DEADLINE
 *                         - TASK_OVERDUE
 *                         - MILESTONE_UPDATE
 *                         - TEAM_UPDATE
 *                         - CONTRIBUTION_REVIEW
 *                         - PROJECT_COMPLETED
 *                     channel:
 *                       type: string
 *                       enum: [IN_APP, EMAIL]
 *                     enabled:
 *                       type: boolean
 *     responses:
 *       200:
 *         description: Preferences updated — returns full preference matrix
 *       400: { description: Validation error }
 *       401: { description: Authentication required }
 */
export async function UpdatePreferences(req, res) {
  try {
    const { preferences } = matchedData(req, { locations: ["body"] });
    const updated = await updatePreferences(req.userId, preferences);
    return res.status(200).json({ preferences: updated });
  } catch (err) {
    return handleError(res, err);
  }
}
