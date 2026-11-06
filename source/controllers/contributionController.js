import { matchedData } from "express-validator";
import {
  listContributions,
  getContribution,
  reviewContribution,
  getProjectContributionSummary,
  ContributionError,
} from "../services/contributionService.js";

function handleError(res, error) {
  if (error instanceof ContributionError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error("contribution operation failed:", error);
  return res.status(500).json({ message: "Internal server error" });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/contributions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/contributions:
 *   get:
 *     tags: [Contributions]
 *     summary: List all contributions on a project
 *     description: Any active project member can call this. Supports optional status filter.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING_REVIEW, CONFIRMED, CHANGES_REQUESTED]
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200: { description: Paginated contributions }
 *       404: { description: Project not found }
 */
export async function ListContributions(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const filters       = matchedData(req, { locations: ["query"] });
    const result        = await listContributions(req.userId, projectId, filters);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/contributions/summary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/contributions/summary:
 *   get:
 *     tags: [Contributions]
 *     summary: Get confirmed contribution summary for the project page
 *     description: >
 *       Returns only CONFIRMED contributions — the project page summary only
 *       shows work after it has been confirmed by an owner or manager.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Confirmed contributions only
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contributions: { type: array }
 *                 total:         { type: integer }
 */
export async function GetContributionSummary(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const result        = await getProjectContributionSummary(req.userId, projectId);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/contributions/:contributionId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/contributions/{contributionId}:
 *   get:
 *     tags: [Contributions]
 *     summary: Get a single contribution with full review history
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: contributionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Contribution with evidence and review history }
 *       404: { description: Contribution not found }
 */
export async function GetContribution(req, res) {
  try {
    const { projectId, contributionId } = matchedData(req, { locations: ["params"] });
    const result = await getContribution(req.userId, projectId, contributionId);
    return res.status(200).json({ contribution: result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/contributions/:contributionId/review
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/contributions/{contributionId}/review:
 *   post:
 *     tags: [Contributions]
 *     summary: Review a contribution (confirm or request changes)
 *     description: >
 *       Reviewer cannot be the contributor. Only Owner / Manager can CONFIRM.
 *       Any non-contributor member can request changes. Contribution must be in
 *       PENDING_REVIEW state. CONFIRMED sets confirmedAt and notifies the contributor.
 *       CHANGES_REQUESTED resets the contribution to PENDING_REVIEW for resubmission.
 *       Each review decision is preserved in the append-only review history.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: contributionId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision:
 *                 type: string
 *                 enum: [CONFIRMED, CHANGES_REQUESTED]
 *               note:
 *                 type: string
 *                 maxLength: 1000
 *                 description: Optional review note shown to the contributor
 *     responses:
 *       200:
 *         description: Contribution reviewed — contributor notified
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contribution: { type: object }
 *       400: { description: Validation error }
 *       403: { description: Self-review not allowed, or member cannot confirm }
 *       404: { description: Contribution not found }
 *       409: { description: Contribution is not in PENDING_REVIEW state }
 */
export async function ReviewContribution(req, res) {
  try {
    const { projectId, contributionId } = matchedData(req, { locations: ["params"] });
    const body = matchedData(req, { locations: ["body"] });
    const result = await reviewContribution(req.userId, projectId, contributionId, body);
    return res.status(200).json({ contribution: result });
  } catch (err) {
    return handleError(res, err);
  }
}
