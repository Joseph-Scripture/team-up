import { matchedData } from "express-validator";
import {
  createDateExtensionRequest,
  listProjectDateExtensionRequests,
  listMyDateExtensionRequests,
  getDateExtensionRequest,
  updateDateExtensionRequest,
  DateExtensionError,
} from "../services/dateExtensionService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared error handler
// ─────────────────────────────────────────────────────────────────────────────

function handleError(res, error) {
  if (error instanceof DateExtensionError) {
    return res.status(error.status).json({ message: error.message });
  }
  // Partial unique index: two PENDING requests raced past the service check.
  if (error.code === "P2002") {
    return res.status(409).json({
      message: "You already have a pending date extension request for this deadline.",
    });
  }
  console.error("date extension operation failed:", error);
  return res.status(500).json({ message: "Internal server error" });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/date-extension-requests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/date-extension-requests:
 *   post:
 *     tags: [DateExtensions]
 *     summary: Request a new date for a project or task deadline
 *     description: >
 *       Any active project member can ask for more time. Omit `taskId` to extend
 *       the project's target end date, or send a `taskId` to extend that task's
 *       due date. The requested date must be later than the current deadline.
 *       The project owner and managers are notified immediately. Only one
 *       PENDING request may exist per member per deadline.
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
 *             required: [requestedDate, reason]
 *             properties:
 *               requestedDate:
 *                 type: string
 *                 format: date-time
 *                 description: Proposed new deadline (must be in the future and later than the current deadline).
 *               reason:
 *                 type: string
 *                 maxLength: 1000
 *                 description: Why the extra time is needed — shown to the reviewer.
 *               taskId:
 *                 type: string
 *                 description: Optional. Task deadline to extend. Omit to extend the project target end date.
 *           examples:
 *             taskDeadline:
 *               summary: Extend a task due date
 *               value:
 *                 taskId: "cm_task_id"
 *                 requestedDate: "2026-11-30T00:00:00.000Z"
 *                 reason: "The API integration took longer than expected."
 *             projectDeadline:
 *               summary: Extend the project target end date
 *               value:
 *                 requestedDate: "2026-12-31T00:00:00.000Z"
 *                 reason: "The team lost a week to a dependency outage."
 *     responses:
 *       201:
 *         description: Date extension request created and reviewers notified
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 request: { $ref: '#/components/schemas/DateExtensionRequest' }
 *       400: { description: Validation error or requested date is not in the future }
 *       403: { description: Not an active project member }
 *       404: { description: Project or task not found }
 *       409: { description: Project inactive, target has no deadline, date is not an extension, or duplicate pending request }
 */
export async function CreateDateExtensionRequest(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const { taskId, requestedDate, reason } = matchedData(req, { locations: ["body"] });
    const request = await createDateExtensionRequest(req.userId, projectId, {
      taskId,
      requestedDate,
      reason,
    });
    return res.status(201).json({ request });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/date-extension-requests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/date-extension-requests:
 *   get:
 *     tags: [DateExtensions]
 *     summary: List date extension requests for a project (owner / manager)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, ACCEPTED, DECLINED, WITHDRAWN] }
 *       - in: query
 *         name: taskId
 *         schema: { type: string }
 *         description: Only requests targeting this task
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated list of date extension requests
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requests: { type: array, items: { $ref: '#/components/schemas/DateExtensionRequest' } }
 *                 pagination: { type: object }
 *       403: { description: Not the project owner or a manager }
 *       404: { description: Project not found }
 */
export async function ListProjectDateExtensionRequests(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const filters = matchedData(req, { locations: ["query"] });
    const result = await listProjectDateExtensionRequests(req.userId, projectId, filters);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/date-extension-requests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/date-extension-requests:
 *   get:
 *     tags: [DateExtensions]
 *     summary: List date extension requests sent by the authenticated user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, ACCEPTED, DECLINED, WITHDRAWN] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated list of the caller's requests
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requests: { type: array, items: { $ref: '#/components/schemas/DateExtensionRequest' } }
 *                 pagination: { type: object }
 */
export async function ListMyDateExtensionRequests(req, res) {
  try {
    const filters = matchedData(req, { locations: ["query"] });
    const result = await listMyDateExtensionRequests(req.userId, filters);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/date-extension-requests/:requestId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/date-extension-requests/{requestId}:
 *   get:
 *     tags: [DateExtensions]
 *     summary: Get a single date extension request
 *     description: Accessible to the requester and to the project owner/managers.
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
 *       200:
 *         description: Date extension request detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 request: { $ref: '#/components/schemas/DateExtensionRequest' }
 *       404: { description: Request not found or not accessible }
 */
export async function GetDateExtensionRequest(req, res) {
  try {
    const { projectId, requestId } = matchedData(req, { locations: ["params"] });
    const request = await getDateExtensionRequest(req.userId, projectId, requestId);
    return res.status(200).json({ request });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/projects/:projectId/date-extension-requests/:requestId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/date-extension-requests/{requestId}:
 *   patch:
 *     tags: [DateExtensions]
 *     summary: Accept, decline, or withdraw a date extension request
 *     description: >
 *       The project owner or a manager sets `status` to ACCEPTED or DECLINED and
 *       may include an optional `decisionNote`. Accepting applies the requested
 *       date to the task (or to the project target end date) atomically and the
 *       requester is notified. The requester may set `status` to WITHDRAWN while
 *       the request is PENDING. A reviewer cannot decide their own request.
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
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [ACCEPTED, DECLINED, WITHDRAWN]
 *               decisionNote:
 *                 type: string
 *                 maxLength: 500
 *                 description: Optional note explaining the decision; sent to the requester.
 *           examples:
 *             accepted:
 *               summary: Accept with a note
 *               value:
 *                 status: ACCEPTED
 *                 decisionNote: "The dependency delay is reasonable; moving the date."
 *             declined:
 *               summary: Decline with a note
 *               value:
 *                 status: DECLINED
 *                 decisionNote: "The final demo date is fixed by the partner."
 *             withdrawn:
 *               summary: Requester withdraws
 *               value:
 *                 status: WITHDRAWN
 *     responses:
 *       200:
 *         description: Updated request; requester notified when accepted or declined
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 request: { $ref: '#/components/schemas/DateExtensionRequest' }
 *       400: { description: Invalid status or validation error }
 *       403: { description: Not permitted (or reviewing your own request) }
 *       404: { description: Request or project not found }
 *       409: { description: Request is no longer PENDING or the new date is no longer an extension }
 */
export async function UpdateDateExtensionRequest(req, res) {
  try {
    const { projectId, requestId } = matchedData(req, { locations: ["params"] });
    const { status, decisionNote } = matchedData(req, { locations: ["body"] });
    const request = await updateDateExtensionRequest(req.userId, projectId, requestId, {
      status,
      decisionNote,
    });
    return res.status(200).json({ request });
  } catch (err) {
    return handleError(res, err);
  }
}
