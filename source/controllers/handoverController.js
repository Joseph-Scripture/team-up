import { matchedData } from "express-validator";
import {
  requestHandover,
  listHandoverRequests,
  acceptHandover,
  declineHandover,
  cancelHandover,
  HandoverError,
} from "../services/handoverService.js";

function handleError(res, error) {
  if (error instanceof HandoverError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error("handover operation failed:", error);
  return res.status(500).json({ message: "Internal server error" });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/tasks/:taskId/handover-request
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/tasks/{taskId}/handover-request:
 *   post:
 *     tags: [Tasks]
 *     summary: Ask the project owner to hand this task over
 *     description: >
 *       Only the member who currently owns the task can ask for a handover.
 *       This ONLY sends a request — the task owner does not change here. The
 *       project owner reassigns the task manually, and only that reassignment
 *       changes the task owner (it then resolves the request as accepted).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note:
 *                 type: string
 *                 maxLength: 1000
 *                 description: Why the handover is needed
 *     responses:
 *       201: { description: Handover requested }
 *       403: { description: Not the owner of the task }
 *       404: { description: Project or task not found }
 *       409: { description: Task has no owner, is closed, or a request is already pending }
 */
export async function RequestHandover(req, res) {
  try {
    const { projectId, taskId } = matchedData(req, { locations: ["params"] });
    const { note } = matchedData(req, { locations: ["body"] });
    const request = await requestHandover(req.userId, projectId, taskId, note);
    return res.status(201).json({ message: "Handover requested — the project owner will decide", request });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/handover-requests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/handover-requests:
 *   get:
 *     tags: [Tasks]
 *     summary: List the handover requests of a project
 *     description: >
 *       The project owner and its managers can read the queue. Managers may
 *       decline a request; only the owner can accept one.
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
 *           enum: [PENDING, ACCEPTED, DECLINED, CANCELLED]
 *           default: PENDING
 *     responses:
 *       200: { description: Array of handover requests }
 *       403: { description: Not the project owner or a manager }
 *       404: { description: Project not found }
 */
export async function ListHandoverRequests(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const { status }   = matchedData(req, { locations: ["query"] });
    const result = await listHandoverRequests(req.userId, projectId, { status });
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/handover-requests/:requestId/accept
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/handover-requests/{requestId}/accept:
 *   post:
 *     tags: [Tasks]
 *     summary: Accept a handover request and hand the task to a new owner
 *     description: >
 *       Project owner only. Accepting IS the reassignment: the owner names the
 *       new owner and the task changes hands in one transaction. This is the
 *       only way (together with PATCH /tasks/:taskId) that changes who owns a
 *       task. The new owner must be an active member and must differ from the
 *       requester — keeping the same person is a decline.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [assigneeMemberId]
 *             properties:
 *               assigneeMemberId:
 *                 type: string
 *                 description: ProjectMember.id of the new task owner
 *               handoverNote:
 *                 type: string
 *                 maxLength: 1000
 *     responses:
 *       200: { description: Handover accepted and the task reassigned }
 *       400: { description: Missing/invalid assignee, or assignee is the requester }
 *       403: { description: Not the project owner }
 *       404: { description: Handover request not found }
 *       409: { description: Already decided }
 */
export async function AcceptHandover(req, res) {
  try {
    const { projectId, requestId } = matchedData(req, { locations: ["params"] });
    const body = matchedData(req, { locations: ["body"] });
    const request = await acceptHandover(req.userId, projectId, requestId, body);
    return res.status(200).json({ message: "Handover accepted — the task was reassigned", request });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/handover-requests/:requestId/decline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/handover-requests/{requestId}/decline:
 *   post:
 *     tags: [Tasks]
 *     summary: Decline a handover request
 *     description: >
 *       The project owner or a manager can decline. The task keeps its current
 *       owner — declining never reassigns anything.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Handover request declined }
 *       403: { description: Not the project owner }
 *       404: { description: Handover request not found }
 *       409: { description: Already decided }
 */
export async function DeclineHandover(req, res) {
  try {
    const { projectId, requestId } = matchedData(req, { locations: ["params"] });
    const request = await declineHandover(req.userId, projectId, requestId);
    return res.status(200).json({ message: "Handover request declined", request });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/handover-requests/:requestId/cancel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/handover-requests/{requestId}/cancel:
 *   post:
 *     tags: [Tasks]
 *     summary: Cancel your own handover request
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Handover request cancelled }
 *       403: { description: Not the requester }
 *       404: { description: Handover request not found }
 *       409: { description: Already decided }
 */
export async function CancelHandover(req, res) {
  try {
    const { projectId, requestId } = matchedData(req, { locations: ["params"] });
    const request = await cancelHandover(req.userId, projectId, requestId);
    return res.status(200).json({ message: "Handover request cancelled", request });
  } catch (err) {
    return handleError(res, err);
  }
}
