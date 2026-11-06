import prisma from "../db/client.js";
import { createNotification } from "./notificationService.js";

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
