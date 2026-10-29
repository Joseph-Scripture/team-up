import { matchedData } from "express-validator";
import {
  sendInvitation,
  acceptInvitation,
  declineInvitation,
  listMyInvitations,
  listProjectInvitations,
  findCollaborators,
  InvitationError,
} from "../services/invitationService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared error handler — maps InvitationError to the right HTTP status and
// handles Prisma's unique-constraint code for the rare DB-level race.
// ─────────────────────────────────────────────────────────────────────────────

function handleError(res, error) {
  if (error instanceof InvitationError) {
    return res.status(error.status).json({ message: error.message });
  }
  // P2002 — unique constraint: duplicate pending invitation slipped past the
  // service-level check because two requests raced. Surface a clean 409.
  if (error.code === "P2002") {
    return res.status(409).json({
      message: "A pending invitation already exists for this user on this project.",
    });
  }
  console.error("invitation operation failed:", error);
  return res.status(500).json({ message: "Internal server error" });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/invitations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/invitations:
 *   post:
 *     tags: [Invitations]
 *     summary: Send an invitation to a user for a specific role
 *     description: >
 *       Only the project owner or a member with MANAGER access can send
 *       invitations. The invitation expires after 7 days. Sending an invitation
 *       also notifies the invitee via the notification system.
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
 *             required: [inviteeId, roleId]
 *             properties:
 *               inviteeId:            { type: string }
 *               roleId:               { type: string }
 *               message:              { type: string, maxLength: 500 }
 *               proposedHoursPerWeek: { type: integer, minimum: 1, maximum: 168 }
 *     responses:
 *       201: { description: Invitation created }
 *       400: { description: Invalid input }
 *       403: { description: Not permitted to send invitations }
 *       404: { description: Project, role, or invitee not found }
 *       409: { description: Duplicate invitation, role full, or user already a member }
 *       401: { description: Authentication required }
 */
export async function SendInvitation(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const body          = matchedData(req, { locations: ["body"] });
    const invitation    = await sendInvitation(req.userId, projectId, body);
    return res.status(201).json({ invitation });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/invitations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/invitations:
 *   get:
 *     tags: [Invitations]
 *     summary: List invitations sent for a project (owner / manager view)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, ACCEPTED, DECLINED, CANCELLED, EXPIRED] }
 *       - in: query
 *         name: roleId
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200: { description: Paginated list of invitations }
 *       403: { description: Not permitted }
 *       404: { description: Project not found }
 */
export async function ListProjectInvitations(req, res) {
  try {
    const { projectId }  = matchedData(req, { locations: ["params"] });
    const filters        = matchedData(req, { locations: ["query"] });
    const result         = await listProjectInvitations(req.userId, projectId, filters);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/invitations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/invitations:
 *   get:
 *     tags: [Invitations]
 *     summary: List invitations received by the authenticated user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, ACCEPTED, DECLINED, CANCELLED, EXPIRED], default: PENDING }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200: { description: Paginated list of received invitations }
 */
export async function ListMyInvitations(req, res) {
  try {
    const filters = matchedData(req, { locations: ["query"] });
    const result  = await listMyInvitations(req.userId, filters);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/invitations/:invitationId/accept
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/invitations/{invitationId}/accept:
 *   post:
 *     tags: [Invitations]
 *     summary: Accept a pending invitation
 *     description: >
 *       Accepts the invitation, creates the membership, and closes the role if
 *       it is now full. Notifies the inviter and project owner. Runs atomically
 *       in a database transaction.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Invitation accepted, membership created }
 *       404: { description: Invitation not found }
 *       409: { description: Already responded, role full, or already a member }
 *       410: { description: Invitation has expired }
 */
export async function AcceptInvitation(req, res) {
  try {
    const { invitationId } = matchedData(req, { locations: ["params"] });
    const result           = await acceptInvitation(req.userId, invitationId);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/invitations/:invitationId/decline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/invitations/{invitationId}/decline:
 *   post:
 *     tags: [Invitations]
 *     summary: Decline a pending invitation
 *     description: >
 *       Declines the invitation. No membership is created. The role slot
 *       remains open. Notifies the inviter.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Invitation declined }
 *       404: { description: Invitation not found or does not belong to this user }
 *       409: { description: Invitation already responded to }
 *       410: { description: Invitation has expired }
 */
export async function DeclineInvitation(req, res) {
  try {
    const { invitationId } = matchedData(req, { locations: ["params"] });
    const result           = await declineInvitation(req.userId, invitationId);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/collaborators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/collaborators:
 *   get:
 *     tags: [Invitations]
 *     summary: Find eligible collaborators for an open role (owner / manager view)
 *     description: >
 *       Returns active, onboarded users who are not already members, have no
 *       pending invitation, and have no pending join request for this project.
 *       Optional filters let the owner narrow by skill, project type, preferred
 *       duration, and weekly availability. The response always includes a top-level
 *       `count` equal to the total number of matching users.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: roleId
 *         required: true
 *         schema: { type: string }
 *         description: The open role being filled
 *       - in: query
 *         name: skills
 *         schema: { type: array, items: { type: string } }
 *         style: form
 *         explode: true
 *         description: Skill IDs — user must possess at least one
 *       - in: query
 *         name: projectType
 *         schema:
 *           type: string
 *           enum: [WEB_APPLICATION, MOBILE_APP, DESKTOP_APP, API_SERVICE, DATA_SCIENCE, DESIGN, OTHER]
 *         description: Filter by project type experience
 *       - in: query
 *         name: durationWeeks
 *         schema: { type: integer, minimum: 1, maximum: 52 }
 *         description: Target project duration — matches users within ±4 weeks of their preference
 *       - in: query
 *         name: weeklyHours
 *         schema: { type: integer, minimum: 1, maximum: 168 }
 *         description: Required weekly hours — user must be available for at least half this value
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200:
 *         description: Matching users with count and pagination
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:       { type: integer, description: "Total number of eligible users" }
 *                 role:        { type: object, properties: { id: { type: string }, title: { type: string } } }
 *                 users:       { type: array }
 *                 pagination:  { type: object }
 *       400: { description: Validation error — roleId is required }
 *       403: { description: Not permitted }
 *       404: { description: Project or role not found }
 *       409: { description: Role is closed }
 */
export async function FindCollaborators(req, res) {
  try {
    const { projectId }            = matchedData(req, { locations: ["params"] });
    const { roleId, ...filters }   = matchedData(req, { locations: ["query"] });
    const result                   = await findCollaborators(req.userId, projectId, roleId, filters);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}
