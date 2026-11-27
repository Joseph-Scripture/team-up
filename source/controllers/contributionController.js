import { matchedData } from "express-validator";
import {
  listContributions,
  getContribution,
  submitContribution,
  acknowledgeContribution,
  reviewContribution,
  editContribution,
  addContributionEvidence,
  getProjectContributionSummary,
  ContributionError,
} from "../services/contributionService.js";
import { sendServerError } from "../lib/dbErrors.js";

function handleError(res, error) {
  if (error instanceof ContributionError) {
    return res.status(error.status).json({ message: error.message });
  }
  return sendServerError(res, error, "contribution operation failed");
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
// POST /api/projects/:projectId/contributions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/contributions:
 *   post:
 *     tags: [Contributions]
 *     summary: Submit your own contribution summary
 *     description: >
 *       Creates the member's ONE contribution summary for this project
 *       (one per member per project — a second call returns 409; further
 *       work is recorded as evidence on the existing summary). First step of
 *       the two-step confirmation: the member reviews their own summary
 *       (acknowledge), and only then can an owner/manager confirm it.
 *       Completed tasks are appended automatically by the task flow.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title:      { type: string, maxLength: 200 }
 *               description: { type: string }
 *               artifactUrl: { type: string, format: uri }
 *               fileUrl:    { type: string, format: uri, description: Cloudinary fileUrl from POST /api/uploads?context=contribution }
 *               fileType:   { type: string, enum: [REPOSITORY, LIVE_DEMO, DOCUMENT, IMAGE, VIDEO, OTHER] }
 *     responses:
 *       201: { description: Contribution summary created }
 *       400: { description: Validation error }
 *       403: { description: Not a member of the project }
 *       404: { description: Project not found }
 *       409: { description: The member already has a summary on this project }
 */
export async function SubmitContribution(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const body = matchedData(req, { locations: ["body"] });
    const contribution = await submitContribution(req.userId, projectId, body);
    return res.status(201).json({ contribution });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/contributions/:contributionId/acknowledge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/contributions/{contributionId}/acknowledge:
 *   post:
 *     tags: [Contributions]
 *     summary: Review and acknowledge your own contribution summary
 *     description: >
 *       Second step of the two-step confirmation. Only the contributor can
 *       acknowledge their own summary, and a teammate can only confirm a
 *       contribution once it has been acknowledged.
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
 *       200: { description: Summary acknowledged }
 *       403: { description: Not the contributor }
 *       404: { description: Contribution not found }
 *       409: { description: Contribution is already confirmed }
 */
export async function AcknowledgeContribution(req, res) {
  try {
    const { projectId, contributionId } = matchedData(req, { locations: ["params"] });
    const contribution = await acknowledgeContribution(req.userId, projectId, contributionId);
    return res.status(200).json({ contribution });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/projects/:projectId/contributions/:contributionId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/contributions/{contributionId}:
 *   patch:
 *     tags: [Contributions]
 *     summary: Edit and resubmit a contribution after changes were requested
 *     description: >
 *       Resubmission flow for CHANGES_REQUESTED. Only the contributor may
 *       edit, and only while the latest review decision is CHANGES_REQUESTED.
 *       The contribution goes back to PENDING_REVIEW with the acknowledgement
 *       cleared (the contributor acknowledges the revised summary again), and
 *       the project owner + managers receive an in-app "please-review"
 *       notification. Manual evidence is only rebuilt when artifactUrl/fileUrl
 *       is sent; TASK_COMPLETION entries (completed tasks) are always
 *       preserved. A title-only edit keeps existing evidence.
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
 *             properties:
 *               title:      { type: string, maxLength: 200 }
 *               description: { type: string, maxLength: 5000 }
 *               artifactUrl: { type: string, format: uri }
 *               fileUrl:    { type: string, format: uri }
 *               fileType:   { type: string, enum: [REPOSITORY, LIVE_DEMO, DOCUMENT, IMAGE, VIDEO, OTHER] }
 *     responses:
 *       200: { description: Contribution updated and back in PENDING_REVIEW }
 *       400: { description: Validation error }
 *       403: { description: Not the contributor }
 *       404: { description: Contribution not found }
 *       409: { description: Not in a changes-requested state, or already confirmed }
 */
export async function EditContribution(req, res) {
  try {
    const { projectId, contributionId } = matchedData(req, { locations: ["params"] });
    const body = matchedData(req, { locations: ["body"] });
    const contribution = await editContribution(req.userId, projectId, contributionId, body);
    return res.status(200).json({ contribution });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/contributions/:contributionId/evidence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/contributions/{contributionId}/evidence:
 *   post:
 *     tags: [Contributions]
 *     summary: Add an evidence link to your contribution summary
 *     description: >
 *       Contributor-only. Attaches an extra proof (repo, demo, document, …)
 *       to their own summary. Silent by design: the summary status and
 *       acknowledgement are untouched and reviewers are NOT notified.
 *       Completed tasks appear as TASK_COMPLETION entries automatically —
 *       those cannot be created through this endpoint.
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
 *             required: [url]
 *             properties:
 *               url:   { type: string, format: uri }
 *               title: { type: string, maxLength: 150 }
 *               type:  { type: string, enum: [REPOSITORY, LIVE_DEMO, DOCUMENT, IMAGE, VIDEO, OTHER] }
 *     responses:
 *       201: { description: Evidence entry created }
 *       400: { description: Validation error }
 *       403: { description: Not the contributor }
 *       404: { description: Contribution not found }
 */
export async function AddContributionEvidence(req, res) {
  try {
    const { projectId, contributionId } = matchedData(req, { locations: ["params"] });
    const body = matchedData(req, { locations: ["body"] });
    const result = await addContributionEvidence(req.userId, projectId, contributionId, body);
    return res.status(201).json(result);
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
 *       The project owner may always confirm their own contribution (no
 *       reviewer exists above them); managers and members can never
 *       self-review. Only Owner / Manager can CONFIRM. Any non-contributor
 *       member can request changes. Contribution must be in PENDING_REVIEW
 *       state. CONFIRMED sets confirmedAt and notifies the contributor.
 *       CHANGES_REQUESTED resets the contribution to PENDING_REVIEW so the
 *       contributor edits and resubmits it via PATCH. Each review decision is
 *       preserved in the append-only review history.
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
