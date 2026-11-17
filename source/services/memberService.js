import prisma from "../db/client.js";
import { createNotification } from "./notificationService.js";
import { resolveVisibility } from "./profileVisibilityService.js";
import { cancelPendingRequestsForMember } from "./handoverService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Custom error
// ─────────────────────────────────────────────────────────────────────────────

export class MemberError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name   = "MemberError";
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// listProjectMembers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List active members of a project.
 * Any active member can call this.
 *
 * @param {string} userId
 * @param {string} projectId
 */
export async function listProjectMembers(userId, projectId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true, ownerId: true,
      memberships: {
        where: { userId, status: "ACTIVE" },
        select: { id: true },
      },
    },
  });

  if (!project) throw new MemberError("Project not found", 404);
  if (project.ownerId !== userId && project.memberships.length === 0) {
    throw new MemberError("Project not found", 404);
  }

  return prisma.projectMember.findMany({
    where:   { projectId, status: "ACTIVE" },
    orderBy: { joinedAt: "asc" },
    select: {
      id: true, accessRole: true, status: true,
      joinedAt: true, committedHoursPerWeek: true,
      acceptedCommitmentAt: true,
      user: { select: { id: true, name: true, avatarUrl: true, headline: true } },
      role: { select: { id: true, title: true } },
      _count: {
        select: {
          assignedTasks: { where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } },
        },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// getMemberContact
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a teammate's contact details.
 *
 * Contact details are never exposed to visitors, pending invitees, or the
 * owner of the project — only to people who are already ACTIVE members of
 * the same project. The member can opt out with `shareContactWithTeam: false`.
 *
 * @param {string} userId   — the authenticated user asking
 * @param {string} projectId
 * @param {string} memberId — ProjectMember.id (not the user's id)
 */
export async function getMemberContact(userId, projectId, memberId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true,
      ownerId: true,
      memberships: {
        where: { userId, status: "ACTIVE" },
        select: { id: true },
      },
    },
  });

  if (!project) throw new MemberError("Project not found", 404);

  // The requester must already be on the team.
  if (project.ownerId !== userId && project.memberships.length === 0) {
    throw new MemberError("Only members of this project can see contact details", 403);
  }

  const membership = await prisma.projectMember.findFirst({
    where: { id: memberId, projectId, status: "ACTIVE" },
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          id: true, name: true, email: true,
          githubUrl: true, portfolioUrl: true,
          location: true, timezone: true,
          visibilitySettings: true,
        },
      },
    },
  });

  if (!membership) throw new MemberError("Member not found on this project", 404);

  const settings = resolveVisibility(membership.user.visibilitySettings);
  if (!settings.shareContactWithTeam) {
    throw new MemberError(
      "This member does not share their contact details with the team",
      403,
    );
  }

  const { visibilitySettings, ...user } = membership.user;
  return {
    memberId: membership.id,
    userId:    user.id,
    name:      user.name,
    email:     user.email,
    githubUrl: user.githubUrl ?? null,
    portfolioUrl: user.portfolioUrl ?? null,
    location:  user.location ?? null,
    timezone:  user.timezone ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// releaseMember
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Owner or Manager releases an active member from the project.
 *
 * Side effects (all in one transaction):
 *  1. Sets ProjectMember.status = RELEASED, endedAt = now, endReason
 *  2. Unassigns all ACTIVE (non-terminal) tasks assigned to this member
 *  3. Reopens the member's role if it was CLOSED — role reappears in discovery
 *
 * @param {string} requesterId  — must be owner or manager
 * @param {string} projectId
 * @param {string} memberId     — ProjectMember.id (not userId)
 * @param {string} [endReason]
 */
export async function releaseMember(requesterId, projectId, memberId, endReason) {
  const now = new Date();

  // ── 1. Permission check ───────────────────────────────────────────────────
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true, title: true, ownerId: true,
      memberships: {
        where: { userId: requesterId, status: "ACTIVE" },
        select: { id: true, accessRole: true },
      },
    },
  });

  if (!project) throw new MemberError("Project not found", 404);

  const isOwner   = project.ownerId === requesterId;
  const isManager = project.memberships[0]?.accessRole === "MANAGER";
  if (!isOwner && !isManager) {
    throw new MemberError("Only the project owner or a manager can release members", 403);
  }

  // ── 2. Load the membership ────────────────────────────────────────────────
  const membership = await prisma.projectMember.findFirst({
    where: { id: memberId, projectId, status: "ACTIVE" },
    select: {
      id: true, userId: true, roleId: true,
      user: { select: { id: true, name: true } },
      role: { select: { id: true, title: true, status: true, requiredMembers: true } },
    },
  });

  if (!membership) throw new MemberError("Member not found on this project", 404);

  // Owner cannot release themselves — they must transfer ownership first
  if (membership.userId === project.ownerId) {
    throw new MemberError("The project owner cannot be released. Transfer ownership first.", 409);
  }

  // ── 3. Transaction: release + unassign tasks + reopen role ────────────────
  await prisma.$transaction(async (tx) => {
    // Release the member
    await tx.projectMember.update({
      where: { id: memberId },
      data: {
        status:    "RELEASED",
        endedAt:   now,
        endReason: endReason ?? null,
      },
    });

    // Unassign all active (non-terminal) tasks belonging to this member
    await tx.task.updateMany({
      where: {
        projectId,
        assigneeMemberId: memberId,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      data: { assigneeMemberId: null },
    });

    // Cancel any pending handover requests from this member — they are no
    // longer on the team so their requests cannot be acted on.
    await cancelPendingRequestsForMember(tx, memberId, projectId, requesterId);

    // Reopen the role if it was CLOSED (it becomes available for new members)
    if (membership.roleId && membership.role?.status === "CLOSED") {
      await tx.projectRole.update({
        where: { id: membership.roleId },
        data:  { status: "OPEN" },
      });
    }
  });

  // ── 4. Notify the released member (fire-and-forget) ───────────────────────
  await createNotification({
    userId:     membership.userId,
    type:       "MEMBER_LEFT",
    projectId,
    entityType: "membership",
    entityId:   memberId,
    title:      `You have been released from ${project.title}`,
    message:    endReason
      ? `You have been released from the ${membership.role?.title ?? "team"} role. Reason: ${endReason}`
      : `You have been released from the ${membership.role?.title ?? "team"} role on ${project.title}.`,
    data: { projectId, roleTitle: membership.role?.title },
    dedupeKey: `member-released:${memberId}`,
  });

  return {
    message:  `${membership.user.name} has been released from the project.`,
    memberId,
    roleReopened: membership.roleId ? membership.role?.status === "CLOSED" : false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// leaveProject
// A member voluntarily leaves a project.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allows an active member to leave a project voluntarily.
 *
 * Side effects (all in one transaction):
 *  1. Sets ProjectMember.status = LEFT, endedAt = now, endReason
 *  2. Unassigns all ACTIVE (non-terminal) tasks assigned to this member
 *  3. Reopens the member's role if it was CLOSED
 *
 * Constraints:
 *  - The project owner cannot leave — they must transfer ownership or delete the project first.
 *  - Only active members can leave.
 *
 * @param {string} userId     — the authenticated user requesting to leave
 * @param {string} projectId
 * @param {string} [reason]   — optional reason
 */
export async function leaveProject(userId, projectId, reason) {
  const now = new Date();

  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, title: true, ownerId: true },
  });

  if (!project) throw new MemberError("Project not found", 404);

  if (project.ownerId === userId) {
    throw new MemberError(
      "The project owner cannot leave. Transfer ownership or delete the project first.",
      409,
    );
  }

  const membership = await prisma.projectMember.findFirst({
    where: { userId, projectId, status: "ACTIVE" },
    select: {
      id: true,
      roleId: true,
      role: { select: { id: true, title: true, status: true } },
    },
  });

  if (!membership) throw new MemberError("You are not an active member of this project", 404);

  await prisma.$transaction(async (tx) => {
    // Mark membership as LEFT
    await tx.projectMember.update({
      where: { id: membership.id },
      data: {
        status:    "LEFT",
        endedAt:   now,
        endReason: reason ?? null,
      },
    });

    // Unassign all active tasks
    await tx.task.updateMany({
      where: {
        projectId,
        assigneeMemberId: membership.id,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      data: { assigneeMemberId: null },
    });

    // Cancel any pending handover requests — member is leaving so they can
    // no longer follow through on them.
    await cancelPendingRequestsForMember(tx, membership.id, projectId, userId);

    // Reopen the role if it was CLOSED
    if (membership.roleId && membership.role?.status === "CLOSED") {
      await tx.projectRole.update({
        where: { id: membership.roleId },
        data:  { status: "OPEN" },
      });
    }
  });

  // Notify the project owner (fire-and-forget)
  await createNotification({
    userId:     project.ownerId,
    type:       "MEMBER_LEFT",
    projectId,
    entityType: "membership",
    entityId:   membership.id,
    title:      `A member has left ${project.title}`,
    message:    reason
      ? `A member left the ${membership.role?.title ?? "team"} role. Reason: ${reason}`
      : `A member left the ${membership.role?.title ?? "team"} role on ${project.title}.`,
    data: { projectId, roleTitle: membership.role?.title },
    dedupeKey: `member-left:${membership.id}`,
  });

  return {
    message:      `You have successfully left ${project.title}.`,
    memberId:     membership.id,
    roleReopened: membership.roleId ? membership.role?.status === "CLOSED" : false,
  };
}
