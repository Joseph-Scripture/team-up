import { matchedData } from "express-validator";
import {
  createMilestone,
  listMilestones,
  updateMilestone,
  deleteMilestone,
  MilestoneError,
} from "../services/milestoneService.js";

function handleError(res, error) {
  if (error instanceof MilestoneError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error("milestone operation failed:", error);
  return res.status(500).json({ message: "Internal server error" });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/milestones
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/milestones:
 *   post:
 *     tags: [Milestones]
 *     summary: Create a milestone on a project
 *     description: Owner / Manager only.
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
 *               title:       { type: string, maxLength: 150 }
 *               description: { type: string }
 *               dueDate:     { type: string, format: date-time }
 *               sortOrder:   { type: integer, minimum: 0, default: 0 }
 *     responses:
 *       201: { description: Milestone created }
 *       400: { description: Validation error }
 *       403: { description: Not permitted }
 *       404: { description: Project not found }
 */
export async function CreateMilestone(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const body          = matchedData(req, { locations: ["body"] });
    const milestone     = await createMilestone(req.userId, projectId, body);
    return res.status(201).json({ milestone });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/milestones
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/milestones:
 *   get:
 *     tags: [Milestones]
 *     summary: List all milestones for a project
 *     description: Any active project member can call this.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Array of milestones ordered by sortOrder then createdAt
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 milestones: { type: array }
 *       403: { description: Not a project member }
 *       404: { description: Project not found }
 */
export async function ListMilestones(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const milestones    = await listMilestones(req.userId, projectId);
    return res.status(200).json({ milestones });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/projects/:projectId/milestones/:milestoneId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/milestones/{milestoneId}:
 *   patch:
 *     tags: [Milestones]
 *     summary: Update a milestone
 *     description: >
 *       Owner / Manager only. All fields are optional — send only what changed.
 *       Setting status to COMPLETED automatically records completedAt.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: milestoneId
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
 *               dueDate:     { type: string, format: date-time }
 *               status:
 *                 type: string
 *                 enum: [TODO, IN_PROGRESS, COMPLETED]
 *               sortOrder:   { type: integer, minimum: 0 }
 *     responses:
 *       200: { description: Updated milestone }
 *       403: { description: Not permitted }
 *       404: { description: Project or milestone not found }
 */
export async function UpdateMilestone(req, res) {
  try {
    const { projectId, milestoneId } = matchedData(req, { locations: ["params"] });
    const body                       = matchedData(req, { locations: ["body"] });
    const milestone = await updateMilestone(req.userId, projectId, milestoneId, body);
    return res.status(200).json({ milestone });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/projects/:projectId/milestones/:milestoneId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/milestones/{milestoneId}:
 *   delete:
 *     tags: [Milestones]
 *     summary: Delete a milestone
 *     description: >
 *       Owner / Manager only. Tasks that belonged to this milestone are unlinked
 *       (milestoneId set to null) — they are NOT deleted.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: milestoneId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Milestone deleted, linked tasks unlinked }
 *       403: { description: Not permitted }
 *       404: { description: Project or milestone not found }
 */
export async function DeleteMilestone(req, res) {
  try {
    const { projectId, milestoneId } = matchedData(req, { locations: ["params"] });
    const result = await deleteMilestone(req.userId, projectId, milestoneId);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}
