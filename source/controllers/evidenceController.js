import { matchedData } from "express-validator";
import {
  listEvidence,
  addEvidence,
  updateEvidence,
  deleteEvidence,
  EvidenceError,
} from "../services/evidenceService.js";

function handleError(res, error) {
  if (error instanceof EvidenceError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error("evidence operation failed:", error);
  return res.status(500).json({ message: "Internal server error" });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/evidence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/evidence:
 *   get:
 *     tags: [Contributions]
 *     summary: List the deliverables of a project
 *     description: >
 *       Deliverables are the proof the team produced something — a repository,
 *       a live demo, a document, an image or a video. A project can only be
 *       completed when at least one deliverable exists.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Array of deliverables }
 *       404: { description: Project not found or not a member }
 */
export async function ListEvidence(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const result = await listEvidence(req.userId, projectId);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/evidence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/evidence:
 *   post:
 *     tags: [Contributions]
 *     summary: Add a deliverable to a project
 *     description: Owner / manager only — they own the project record.
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
 *             required: [title, url]
 *             properties:
 *               title:       { type: string, maxLength: 150 }
 *               description: { type: string }
 *               url:         { type: string, format: uri }
 *               type:
 *                 type: string
 *                 enum: [REPOSITORY, LIVE_DEMO, DOCUMENT, IMAGE, VIDEO, OTHER]
 *     responses:
 *       201: { description: Deliverable added }
 *       400: { description: Validation error }
 *       403: { description: Not the owner or a manager }
 *       404: { description: Project not found }
 */
export async function AddEvidence(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const body = matchedData(req, { locations: ["body"] });
    const evidence = await addEvidence(req.userId, projectId, body);
    return res.status(201).json({ evidence });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/projects/:projectId/evidence/:evidenceId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/evidence/{evidenceId}:
 *   patch:
 *     tags: [Contributions]
 *     summary: Update a deliverable
 *     description: >
 *       Patch semantics — only the fields you send are written. Owner / manager only.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: evidenceId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:       { type: string, maxLength: 150 }
 *               description: { type: string }
 *               url:         { type: string, format: uri }
 *               type:
 *                 type: string
 *                 enum: [REPOSITORY, LIVE_DEMO, DOCUMENT, IMAGE, VIDEO, OTHER]
 *     responses:
 *       200: { description: Deliverable updated }
 *       400: { description: Validation error or no fields provided }
 *       403: { description: Not the owner or a manager }
 *       404: { description: Deliverable not found }
 */
export async function UpdateEvidence(req, res) {
  try {
    const { projectId, evidenceId } = matchedData(req, { locations: ["params"] });
    const body = matchedData(req, { locations: ["body"] });
    const evidence = await updateEvidence(req.userId, projectId, evidenceId, body);
    return res.status(200).json({ evidence });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/projects/:projectId/evidence/:evidenceId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/evidence/{evidenceId}:
 *   delete:
 *     tags: [Contributions]
 *     summary: Remove a deliverable
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: evidenceId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deliverable removed }
 *       403: { description: Not the owner or a manager }
 *       404: { description: Deliverable not found }
 */
export async function DeleteEvidence(req, res) {
  try {
    const { projectId, evidenceId } = matchedData(req, { locations: ["params"] });
    const result = await deleteEvidence(req.userId, projectId, evidenceId);
    return res.status(200).json({ message: "Deliverable removed", ...result });
  } catch (err) {
    return handleError(res, err);
  }
}
