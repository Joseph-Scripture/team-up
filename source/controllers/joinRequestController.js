import { matchedData } from "express-validator";
import {
  sendJoinRequest,
  withdrawJoinRequest,
  approveJoinRequest,
  declineJoinRequest,
  confirmJoinRequest,
  getJoinRequestDetail,
  listProjectJoinRequests,
  listMyJoinRequests,
  JoinRequestError,
} from "../services/joinRequestService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared error handler
// ─────────────────────────────────────────────────────────────────────────────

function handleError(res, error) {
  if (error instanceof JoinRequestError) {
    return res.status(error.status).json({ message: error.message });
  }
  // P2002 — unique constraint: duplicate pending request slipped past the
  // service-level check because two requests raced. Surface a clean 409.
  if (error.code === "P2002") {
    return res.status(409).json({
      message: "You already have a pending join request for this project.",
    });
  }
  console.error("join request operation failed:", error);
  return res.status(500).json({ message: "Internal server error" });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/join-requests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/join-requests:
 *   post:
 *     tags: [JoinRequests]
 *     summary: Send a join request for a role on a project
 *     description: >
 *       Applicant sends a request to join a specific open role. The project owner
 *       must approve before the applicant can confirm their commitment. Sending a
 *       request also notifies the project owner.
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
 *             required: [roleId]
 *             properties:
 *               roleId:               { type: string }
 *               message:              { type: string, maxLength: 1000 }
 *               proposedHoursPerWeek: { type: integer, minimum: 1, maximum: 168 }
 *               plannedTaskDeadlines: { type: string, maxLength: 2000 }
 *     responses:
 *       201: { description: Join request created }
 *       400: { description: Validation error }
 *       403: { description: Cannot apply to own project }
 *       404: { description: Project or role not found }
 *       409: { description: Already a member, duplicate request, or pending invitation }
 */
export async function SendJoinRequest(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const body          = matchedData(req, { locations: ["body"] });
    const request       = await sendJoinRequest(req.userId, projectId, body);
    return res.status(201).json({ request });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/join-requests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/join-requests:
 *   get:
 *     tags: [JoinRequests]
 *     summary: List join requests for a project (owner / manager view)
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
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200: { description: Paginated list of join requests }
 *       403: { description: Not permitted }
 *       404: { description: Project not found }
 */
export async function ListProjectJoinRequests(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const filters       = matchedData(req, { locations: ["query"] });
    const result        = await listProjectJoinRequests(req.userId, projectId, filters);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/join-requests/:requestId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/join-requests/{requestId}:
 *   get:
 *     tags: [JoinRequests]
 *     summary: Get full detail of a single join request
 *     description: >
 *       Returns the join request with full project context, role requirements,
 *       milestones, and requester profile. Used by the owner review screen (Screen 2)
 *       and the applicant commitment screen (Screen 3). Accessible by the requester
 *       and the project owner / manager only.
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
 *       200: { description: Full join request detail }
 *       404: { description: Not found or not accessible }
 */
export async function GetJoinRequestDetail(req, res) {
  try {
    const { requestId } = matchedData(req, { locations: ["params"] });
    const result        = await getJoinRequestDetail(req.userId, requestId);
    return res.status(200).json({ request: result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/join-requests/:requestId/approve
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/join-requests/{requestId}/approve:
 *   post:
 *     tags: [JoinRequests]
 *     summary: Approve a pending join request (owner / manager only)
 *     description: >
 *       Moves the request to ACCEPTED and notifies the applicant. Does NOT
 *       create a membership — the applicant must confirm their commitment via
 *       POST /api/join-requests/:requestId/confirm.
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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               decisionNote: { type: string, maxLength: 500 }
 *     responses:
 *       200: { description: Request approved }
 *       403: { description: Not permitted }
 *       404: { description: Request or project not found }
 *       409: { description: Request not in PENDING state, or role full / closed }
 */
export async function ApproveJoinRequest(req, res) {
  try {
    const { projectId, requestId } = matchedData(req, { locations: ["params"] });
    const { decisionNote }         = matchedData(req, { locations: ["body"] });
    const result = await approveJoinRequest(req.userId, projectId, requestId, decisionNote);
    return res.status(200).json({ request: result });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/join-requests/:requestId/decline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/join-requests/{requestId}/decline:
 *   post:
 *     tags: [JoinRequests]
 *     summary: Decline a pending join request (owner / manager only)
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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               decisionNote: { type: string, maxLength: 500 }
 *     responses:
 *       200: { description: Request declined }
 *       403: { description: Not permitted }
 *       404: { description: Request or project not found }
 *       409: { description: Request not in PENDING state }
 */
export async function DeclineJoinRequest(req, res) {
  try {
    const { projectId, requestId } = matchedData(req, { locations: ["params"] });
    const { decisionNote }         = matchedData(req, { locations: ["body"] });
    const result = await declineJoinRequest(req.userId, projectId, requestId, decisionNote);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/join-requests  (my sent requests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/join-requests:
 *   get:
 *     tags: [JoinRequests]
 *     summary: List join requests sent by the authenticated user
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
 *       200: { description: Paginated list of my join requests }
 */
export async function ListMyJoinRequests(req, res) {
  try {
    const filters = matchedData(req, { locations: ["query"] });
    const result  = await listMyJoinRequests(req.userId, filters);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/join-requests/:requestId/withdraw
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/join-requests/{requestId}/withdraw:
 *   post:
 *     tags: [JoinRequests]
 *     summary: Withdraw a PENDING or ACCEPTED join request
 *     description: >
 *       Requester withdraws their own request. Allowed in both PENDING and ACCEPTED
 *       states — the applicant can still back out before confirming their commitment.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Request withdrawn }
 *       404: { description: Request not found or does not belong to this user }
 *       409: { description: Request cannot be withdrawn in its current state }
 */
export async function WithdrawJoinRequest(req, res) {
  try {
    const { requestId } = matchedData(req, { locations: ["params"] });
    const result        = await withdrawJoinRequest(req.userId, requestId);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/join-requests/:requestId/confirm
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/join-requests/{requestId}/confirm:
 *   post:
 *     tags: [JoinRequests]
 *     summary: Confirm commitment and join the project (requester only)
 *     description: >
 *       The final step of the join flow. Only callable after the owner has approved
 *       the request (status = ACCEPTED). Creates the ProjectMember row, closes the
 *       role if now full, and notifies the project owner. Runs atomically in a
 *       database transaction.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Membership created, project joined }
 *       404: { description: Request not found }
 *       409: { description: Not approved yet, role full, or already a member }
 */
export async function ConfirmJoinRequest(req, res) {
  try {
    const { requestId } = matchedData(req, { locations: ["params"] });
    const result        = await confirmJoinRequest(req.userId, requestId);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}
