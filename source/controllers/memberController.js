import { matchedData } from "express-validator";
import {
  listProjectMembers,
  releaseMember,
  leaveProject,
  MemberError,
} from "../services/memberService.js";

function handleError(res, error) {
  if (error instanceof MemberError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error("member operation failed:", error);
  return res.status(500).json({ message: "Internal server error" });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/members
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/members:
 *   get:
 *     tags: [Members]
 *     summary: List active members of a project
 *     description: >
 *       Returns all active members with their role, access level, joined date,
 *       and a count of their open (non-completed) tasks.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Array of active members }
 *       404: { description: Project not found or not a member }
 */
export async function ListProjectMembers(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const members       = await listProjectMembers(req.userId, projectId);
    return res.status(200).json({ members });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/members/:memberId/release
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/members/{memberId}/release:
 *   post:
 *     tags: [Members]
 *     summary: Release a member from a project
 *     description: >
 *       Owner / Manager only. Releases the member (status → RELEASED), unassigns
 *       all their active tasks, and reopens their role so it reappears in discovery.
 *       The released member receives a notification. The project owner cannot be
 *       released — transfer ownership first.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: memberId
 *         required: true
 *         schema: { type: string }
 *         description: ProjectMember.id (not the user's id)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               endReason:
 *                 type: string
 *                 maxLength: 500
 *                 description: Optional reason shown to the released member
 *     responses:
 *       200:
 *         description: Member released, tasks unassigned, role reopened
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:      { type: string }
 *                 memberId:     { type: string }
 *                 roleReopened: { type: boolean }
 *       403: { description: Not permitted or attempting to release the owner }
 *       404: { description: Member not found }
 *       409: { description: Cannot release the project owner }
 */
export async function ReleaseMember(req, res) {
  try {
    const { projectId, memberId } = matchedData(req, { locations: ["params"] });
    const { endReason }           = matchedData(req, { locations: ["body"] });
    const result = await releaseMember(req.userId, projectId, memberId, endReason);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/members/leave
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/members/leave:
 *   post:
 *     tags: [Members]
 *     summary: Leave a project voluntarily
 *     description: >
 *       Allows an active member to leave a project. Sets the membership status
 *       to LEFT, unassigns all their active tasks, and reopens their role.
 *       The project owner cannot leave — transfer ownership or delete the project first.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 maxLength: 500
 *                 description: Optional reason for leaving
 *     responses:
 *       200:
 *         description: Successfully left the project
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:      { type: string }
 *                 memberId:     { type: string }
 *                 roleReopened: { type: boolean }
 *       404: { description: Project not found or not an active member }
 *       409: { description: Owner cannot leave — transfer ownership first }
 */
export async function LeaveProject(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const { reason }    = matchedData(req, { locations: ["body"] });
    const result = await leaveProject(req.userId, projectId, reason);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}
