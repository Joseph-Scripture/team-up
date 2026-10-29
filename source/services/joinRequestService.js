import prisma from "../db/client.js";
import { createNotification } from "./notificationService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const REQUESTS_PER_PAGE  = 20;
const MAX_PER_PAGE       = 50;

const ACTIVE_PROJECT_STATUSES = ["OPEN", "IN_PROGRESS"];

// ─────────────────────────────────────────────────────────────────────────────
// Custom error
// ─────────────────────────────────────────────────────────────────────────────

export class JoinRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name   = "JoinRequestError";
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification helpers (fire-and-forget wrappers)
// ─────────────────────────────────────────────────────────────────────────────

async function notifyJoinRequestSent({ request, project, role, requesterName }) {
  await createNotification({
    userId:     project.ownerId,
    type:       "JOIN_REQUEST",
    projectId:  project.id,
    entityType: "joinRequest",
    entityId:   request.id,
    title:      `${requesterName} wants to join ${project.title}`,
    message:    `${requesterName} sent a join request for the ${role.title} role.`,
    data: {
      joinRequestId: request.id,
      projectSlug:   project.slug,
      roleTitle:     role.title,
    },
    dedupeKey: `join-request-sent:${request.id}`,
  });
}

async function notifyJoinRequestDecided({ request, project, role, requesterName, decision }) {
  const approved = decision === "ACCEPTED";
  await createNotification({
    userId:     request.requesterId,
    type:       "JOIN_REQUEST_DECIDED",
    projectId:  project.id,
    entityType: "joinRequest",
    entityId:   request.id,
    title:      approved
      ? `Your request to join ${project.title} was approved`
      : `Your request to join ${project.title} was declined`,
    message:    approved
      ? `You can now review your commitment and confirm your place as ${role.title}.`
      : `The owner has declined your request for the ${role.title} role.`,
    data: {
      joinRequestId: request.id,
      projectSlug:   project.slug,
      roleTitle:     role.title,
      decision,
    },
    dedupeKey: `join-request-decided:${request.id}`,
  });
}

async function notifyMemberJoinedViaRequest({ project, role, requesterName, membershipId, ownerId }) {
  // The owner always sees the MEMBER_JOINED notification when commit is done.
  await createNotification({
    userId:     ownerId,
    type:       "MEMBER_JOINED",
    projectId:  project.id,
    entityType: "membership",
    entityId:   membershipId,
    title:      `${requesterName} joined ${project.title}`,
    message:    `${requesterName} confirmed their commitment and joined as ${role.title}.`,
    data: {
      projectSlug: project.slug,
      roleTitle:   role.title,
    },
    dedupeKey: `member-joined-request:${membershipId}`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// sendJoinRequest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applicant sends a join request for a specific role on a project.
 *
 * Business rules:
 *  1. Project must exist, not be soft-deleted, and be OPEN
 *  2. Requester must not be the project owner
 *  3. Role must exist, belong to this project, and be OPEN
 *  4. Role must still have capacity
 *  5. Requester must not already be an active member
 *  6. No existing PENDING join request for this (project, requester)
 *  7. No existing PENDING invitation for this (project, requester)
 *
 * @param {string} requesterId
 * @param {string} projectId
 * @param {object} body
 * @param {string}  body.roleId
 * @param {string}  [body.message]
 * @param {number}  [body.proposedHoursPerWeek]
 * @param {string}  [body.plannedTaskDeadlines]
 */
export async function sendJoinRequest(requesterId, projectId, {
  roleId,
  message,
  proposedHoursPerWeek,
  plannedTaskDeadlines,
}) {
  // ── 1. Load project with the target role ──────────────────────────────────
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true, title: true, slug: true, status: true, ownerId: true,
      roles: {
        where: { id: roleId },
        select: {
          id: true, title: true, status: true,
          requiredMembers: true,
          _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
        },
      },
    },
  });

  if (!project) throw new JoinRequestError("Project not found", 404);

  // ── 2. Requester cannot be the owner ─────────────────────────────────────
  if (project.ownerId === requesterId) {
    throw new JoinRequestError("You cannot send a join request to your own project", 403);
  }

  // ── 3. Project must be open for recruitment ───────────────────────────────
  if (!ACTIVE_PROJECT_STATUSES.includes(project.status)) {
    throw new JoinRequestError(
      `Join requests can only be sent for OPEN or IN_PROGRESS projects (current status: ${project.status})`,
      409,
    );
  }

  // ── 4. Role must exist, belong to this project, and be OPEN ──────────────
  const role = project.roles[0];
  if (!role) throw new JoinRequestError("Role not found on this project", 404);
  if (role.status !== "OPEN") {
    throw new JoinRequestError("This role is closed and no longer accepting members", 409);
  }

  // ── 5. Role must still have capacity ─────────────────────────────────────
  if (role._count.memberships >= role.requiredMembers) {
    throw new JoinRequestError("This role has no remaining open slots", 409);
  }

  // ── 6. Requester must not already be an active member ────────────────────
  const alreadyMember = await prisma.projectMember.findFirst({
    where: { projectId, userId: requesterId, status: "ACTIVE" },
  });
  if (alreadyMember) {
    throw new JoinRequestError("You are already an active member of this project", 409);
  }

  // ── 7. No existing PENDING join request for this (project, requester) ────
  const existingRequest = await prisma.joinRequest.findFirst({
    where: { projectId, requesterId, status: "PENDING" },
  });
  if (existingRequest) {
    throw new JoinRequestError(
      "You already have a pending join request for this project",
      409,
    );
  }

  // ── 8. No existing PENDING invitation for this (project, requester) ──────
  const existingInvitation = await prisma.projectInvitation.findFirst({
    where: {
      projectId,
      inviteeId: requesterId,
      status: "PENDING",
      OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
    },
  });
  if (existingInvitation) {
    throw new JoinRequestError(
      "You already have a pending invitation for this project. Accept or decline it first.",
      409,
    );
  }

  // ── 9. Create the request ─────────────────────────────────────────────────
  const request = await prisma.joinRequest.create({
    data: {
      projectId,
      requesterId,
      roleId,
      message:              message              ?? null,
      proposedHoursPerWeek: proposedHoursPerWeek ?? null,
      plannedTaskDeadlines: plannedTaskDeadlines ?? null,
      status: "PENDING",
    },
    select: {
      id: true, status: true, message: true,
      proposedHoursPerWeek: true, plannedTaskDeadlines: true,
      createdAt: true,
      project:   { select: { id: true, title: true, slug: true } },
      requester: { select: { id: true, name: true, avatarUrl: true } },
      role:      { select: { id: true, title: true, description: true, hoursPerWeek: true } },
    },
  });

  // ── 10. Notify owner (fire-and-forget) ────────────────────────────────────
  await notifyJoinRequestSent({
    request: { id: request.id, requesterId },
    project: { id: project.id, title: project.title, slug: project.slug, ownerId: project.ownerId },
    role:    { title: role.title },
    requesterName: request.requester.name,
  });

  return request;
}

// ─────────────────────────────────────────────────────────────────────────────
// withdrawJoinRequest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Requester withdraws their own PENDING or ACCEPTED request.
 * A single conditional updateMany makes ownership + state check atomic.
 *
 * @param {string} requesterId
 * @param {string} requestId
 */
export async function withdrawJoinRequest(requesterId, requestId) {
  const { count } = await prisma.joinRequest.updateMany({
    where: {
      id:          requestId,
      requesterId,
      status:      { in: ["PENDING", "ACCEPTED"] },
    },
    data: { status: "WITHDRAWN" },
  });

  if (count === 0) {
    const existing = await prisma.joinRequest.findUnique({
      where:  { id: requestId },
      select: { requesterId: true, status: true },
    });
    if (!existing || existing.requesterId !== requesterId) {
      throw new JoinRequestError("Join request not found", 404);
    }
    throw new JoinRequestError(
      `This request cannot be withdrawn (current status: ${existing.status.toLowerCase()})`,
      409,
    );
  }

  return { message: "Join request withdrawn." };
}

// ─────────────────────────────────────────────────────────────────────────────
// approveJoinRequest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Owner approves a PENDING join request.
 * This does NOT create membership — it unlocks the commit screen for the applicant.
 *
 * @param {string} ownerId
 * @param {string} projectId
 * @param {string} requestId
 * @param {string} [decisionNote]
 */
export async function approveJoinRequest(ownerId, projectId, requestId, decisionNote) {
  const now = new Date();

  // ── 1. Load project — owner check ─────────────────────────────────────────
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true, title: true, slug: true, status: true, ownerId: true,
      memberships: {
        where: { userId: ownerId, status: "ACTIVE" },
        select: { accessRole: true },
      },
    },
  });

  if (!project) throw new JoinRequestError("Project not found", 404);

  const isOwner   = project.ownerId === ownerId;
  const isManager = project.memberships[0]?.accessRole === "MANAGER";
  if (!isOwner && !isManager) {
    throw new JoinRequestError("Only the project owner or a manager can approve requests", 403);
  }

  // ── 2. Load and validate the request ─────────────────────────────────────
  const request = await prisma.joinRequest.findFirst({
    where: { id: requestId, projectId },
    select: {
      id: true, requesterId: true, roleId: true, status: true,
      requester: { select: { id: true, name: true } },
      role: {
        select: {
          id: true, title: true, status: true,
          requiredMembers: true,
          _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
        },
      },
    },
  });

  if (!request) throw new JoinRequestError("Join request not found", 404);
  if (request.status !== "PENDING") {
    throw new JoinRequestError(
      `This request cannot be approved (current status: ${request.status.toLowerCase()})`,
      409,
    );
  }

  // ── 3. Re-check role is still open and has capacity ──────────────────────
  if (!request.role || request.role.status !== "OPEN") {
    throw new JoinRequestError("The role is no longer open", 409);
  }
  if (request.role._count.memberships >= request.role.requiredMembers) {
    throw new JoinRequestError("This role has no remaining open slots", 409);
  }

  // ── 4. Approve ────────────────────────────────────────────────────────────
  const updated = await prisma.joinRequest.update({
    where: { id: requestId },
    data: {
      status:      "ACCEPTED",
      reviewerId:  ownerId,
      reviewedAt:  now,
      decisionNote: decisionNote ?? null,
    },
    select: {
      id: true, status: true, decisionNote: true, reviewedAt: true,
      requester: { select: { id: true, name: true, avatarUrl: true } },
      role:      { select: { id: true, title: true } },
    },
  });

  // ── 5. Notify requester (fire-and-forget) ─────────────────────────────────
  await notifyJoinRequestDecided({
    request: { id: request.id, requesterId: request.requesterId },
    project: { id: project.id, title: project.title, slug: project.slug },
    role:    { title: request.role.title },
    requesterName: request.requester.name,
    decision: "ACCEPTED",
  });

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// declineJoinRequest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Owner declines a PENDING join request.
 *
 * @param {string} ownerId
 * @param {string} projectId
 * @param {string} requestId
 * @param {string} [decisionNote]
 */
export async function declineJoinRequest(ownerId, projectId, requestId, decisionNote) {
  const now = new Date();

  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true, title: true, slug: true, ownerId: true,
      memberships: {
        where: { userId: ownerId, status: "ACTIVE" },
        select: { accessRole: true },
      },
    },
  });

  if (!project) throw new JoinRequestError("Project not found", 404);

  const isOwner   = project.ownerId === ownerId;
  const isManager = project.memberships[0]?.accessRole === "MANAGER";
  if (!isOwner && !isManager) {
    throw new JoinRequestError("Only the project owner or a manager can decline requests", 403);
  }

  const request = await prisma.joinRequest.findFirst({
    where: { id: requestId, projectId },
    select: {
      id: true, requesterId: true, status: true,
      requester: { select: { name: true } },
      role:      { select: { title: true } },
    },
  });

  if (!request) throw new JoinRequestError("Join request not found", 404);
  if (request.status !== "PENDING") {
    throw new JoinRequestError(
      `This request cannot be declined (current status: ${request.status.toLowerCase()})`,
      409,
    );
  }

  await prisma.joinRequest.update({
    where: { id: requestId },
    data: {
      status:      "DECLINED",
      reviewerId:  ownerId,
      reviewedAt:  now,
      decisionNote: decisionNote ?? null,
    },
  });

  // Notify requester (fire-and-forget)
  await notifyJoinRequestDecided({
    request: { id: request.id, requesterId: request.requesterId },
    project: { id: project.id, title: project.title, slug: project.slug },
    role:    { title: request.role?.title ?? "Unknown role" },
    requesterName: request.requester.name,
    decision: "DECLINED",
  });

  return { message: "Join request declined." };
}

// ─────────────────────────────────────────────────────────────────────────────
// confirmJoinRequest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Requester confirms their commitment after the owner has approved.
 * This is the step that CREATES the ProjectMember row.
 *
 * Runs in a Prisma transaction:
 *  1. Re-validates ownership, request status, role capacity (race-condition guard)
 *  2. Creates ProjectMember
 *  3. Closes the role if now full
 *  4. Marks request as having a resulting membership (via resultingMembership relation)
 *
 * Notifications fired after transaction commits.
 *
 * @param {string} requesterId
 * @param {string} requestId
 */
export async function confirmJoinRequest(requesterId, requestId) {
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // ── a. Load request with full context ────────────────────────────────────
    const request = await tx.joinRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true, requesterId: true, roleId: true, status: true,
        project: {
          select: {
            id: true, title: true, slug: true,
            status: true, ownerId: true, deletedAt: true,
          },
        },
        role: {
          select: {
            id: true, title: true,
            requiredMembers: true,
            _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
          },
        },
        requester: { select: { id: true, name: true } },
      },
    });

    // Serialize admissions for a role before counting memberships. Concurrent
    // confirmations must observe each other's committed membership.
    if (request?.roleId) {
      await tx.$queryRaw`SELECT "id" FROM "ProjectRole" WHERE "id" = ${request.roleId} FOR UPDATE`;
    }

    if (!request) throw new JoinRequestError("Join request not found", 404);

    // ── b. Must belong to the requester ──────────────────────────────────────
    if (request.requesterId !== requesterId) {
      throw new JoinRequestError("Join request not found", 404);
    }

    // ── c. Request must be ACCEPTED by the owner ──────────────────────────────
    if (request.status !== "ACCEPTED") {
      if (request.status === "PENDING") {
        throw new JoinRequestError(
          "The project owner has not approved your request yet",
          409,
        );
      }
      throw new JoinRequestError(
        `This request cannot be confirmed (current status: ${request.status.toLowerCase()})`,
        409,
      );
    }

    // ── d. Project must still be active ──────────────────────────────────────
    if (request.project.deletedAt || !ACTIVE_PROJECT_STATUSES.includes(request.project.status)) {
      throw new JoinRequestError("This project is no longer accepting members", 409);
    }

    // ── e. Role must still have capacity ─────────────────────────────────────
    const activeMemberCount = request.role._count.memberships;
    if (activeMemberCount >= request.role.requiredMembers) {
      throw new JoinRequestError(
        "This role has no remaining open slots. Contact the project owner.",
        409,
      );
    }

    // ── f. Not already an active member ──────────────────────────────────────
    const alreadyMember = await tx.projectMember.findFirst({
      where: { projectId: request.project.id, userId: requesterId, status: "ACTIVE" },
    });
    if (alreadyMember) {
      throw new JoinRequestError("You are already an active member of this project", 409);
    }

    // ── g. Create membership ──────────────────────────────────────────────────
    const membership = await tx.projectMember.create({
      data: {
        projectId:    request.project.id,
        userId:       requesterId,
        roleId:       request.roleId,
        accessRole:   "MEMBER",
        status:       "ACTIVE",
        joinRequestId: requestId,
        joinedAt:     now,
      },
    });

    // ── h. Close the role if now full ─────────────────────────────────────────
    const newCount = activeMemberCount + 1;
    if (newCount >= request.role.requiredMembers) {
      await tx.projectRole.update({
        where: { id: request.roleId },
        data:  { status: "CLOSED" },
      });
    }

    return { request, membership };
  });

  const { request, membership } = result;

  // ── Notifications (after transaction, never inside it) ────────────────────
  await notifyMemberJoinedViaRequest({
    project:       { id: request.project.id, title: request.project.title, slug: request.project.slug },
    role:          { title: request.role.title },
    requesterName: request.requester.name,
    membershipId:  membership.id,
    ownerId:       request.project.ownerId,
  });

  return {
    message:      "Commitment confirmed. You are now a member of the project.",
    projectId:    request.project.id,
    projectSlug:  request.project.slug,
    membershipId: membership.id,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getJoinRequestDetail
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load the full detail of a single join request.
 * Used by:
 *  - The owner's review screen (Screen 2)
 *  - The requester's commit screen (Screen 3)
 *
 * Includes project detail, role requirements, milestones, and requester profile.
 *
 * @param {string} userId      — either the requester or the project owner/manager
 * @param {string} requestId
 */
export async function getJoinRequestDetail(userId, requestId) {
  const request = await prisma.joinRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true, status: true,
      message: true, proposedHoursPerWeek: true, plannedTaskDeadlines: true,
      decisionNote: true, reviewedAt: true, createdAt: true,
      requester: {
        select: {
          id: true, name: true, avatarUrl: true,
          headline: true, bio: true, goals: true,
          isAvailable: true, weeklyAvailabilityHours: true,
          preferredProjectDurationWeeks: true,
          skills: {
            select: {
              level: true,
              skill: { select: { id: true, name: true, slug: true, category: true } },
            },
          },
        },
      },
      project: {
        select: {
          id: true, title: true, slug: true, description: true,
          problem: true, outcome: true,
          projectType: true, status: true,
          durationWeeks: true, weeklyHours: true,
          startDate: true, targetEndDate: true,
          availabilityExpectation: true, availabilityResponseExpectation: true,
          ownerId: true,
          owner: { select: { id: true, name: true, avatarUrl: true } },
          skills: {
            include: {
              skill: { select: { id: true, name: true, slug: true, category: true } },
            },
          },
          milestones: {
            orderBy: { sortOrder: "asc" },
            select: { id: true, title: true, dueDate: true, status: true },
          },
        },
      },
      role: {
        select: {
          id: true, title: true, description: true,
          hoursPerWeek: true, requiredMembers: true, status: true,
          skills: {
            include: {
              skill: { select: { id: true, name: true, slug: true, category: true } },
            },
          },
        },
      },
    },
  });

  if (!request) throw new JoinRequestError("Join request not found", 404);

  // Access control: only the requester or the project owner/manager may view
  const isRequester = request.requester.id === userId;
  const isOwner     = request.project.ownerId === userId;

  if (!isRequester && !isOwner) {
    // Check if user is a manager
    const membership = await prisma.projectMember.findFirst({
      where: {
        projectId: request.project.id,
        userId,
        status: "ACTIVE",
        accessRole: "MANAGER",
      },
    });
    if (!membership) throw new JoinRequestError("Join request not found", 404);
  }

  return request;
}

// ─────────────────────────────────────────────────────────────────────────────
// listProjectJoinRequests  (owner / manager view)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all join requests for a project (owner/manager only).
 * Supports optional ?status filter and pagination.
 *
 * @param {string} requesterId — authenticated user (must be owner or manager)
 * @param {string} projectId
 * @param {object} opts
 * @param {string} [opts.status]
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=20]
 */
export async function listProjectJoinRequests(requesterId, projectId, { status, page = 1, limit = REQUESTS_PER_PAGE } = {}) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      ownerId: true,
      memberships: {
        where: { userId: requesterId, status: "ACTIVE" },
        select: { accessRole: true },
      },
    },
  });

  if (!project) throw new JoinRequestError("Project not found", 404);

  const isOwner   = project.ownerId === requesterId;
  const isManager = project.memberships[0]?.accessRole === "MANAGER";
  if (!isOwner && !isManager) {
    throw new JoinRequestError("Only the project owner or a manager can view join requests", 403);
  }

  const VALID_STATUSES = ["PENDING", "ACCEPTED", "DECLINED", "WITHDRAWN"];
  const safePage  = Math.max(1, Number(page));
  const safeLimit = Math.min(MAX_PER_PAGE, Math.max(1, Number(limit)));
  const skip      = (safePage - 1) * safeLimit;

  const statusFilter = status && VALID_STATUSES.includes(status.toUpperCase())
    ? status.toUpperCase()
    : undefined;

  const where = {
    projectId,
    ...(statusFilter && { status: statusFilter }),
  };

  const [requests, total] = await Promise.all([
    prisma.joinRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: safeLimit,
      select: {
        id: true, status: true,
        message: true, proposedHoursPerWeek: true,
        plannedTaskDeadlines: true, createdAt: true, reviewedAt: true,
        requester: { select: { id: true, name: true, avatarUrl: true, headline: true } },
        role:      { select: { id: true, title: true } },
      },
    }),
    prisma.joinRequest.count({ where }),
  ]);

  return {
    requests,
    pagination: {
      total,
      page:       safePage,
      limit:      safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// listMyJoinRequests  (requester view)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List join requests sent by the authenticated user.
 * Supports optional ?status filter and pagination.
 *
 * @param {string} userId
 * @param {object} opts
 * @param {string} [opts.status]
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=20]
 */
export async function listMyJoinRequests(userId, { status, page = 1, limit = REQUESTS_PER_PAGE } = {}) {
  const VALID_STATUSES = ["PENDING", "ACCEPTED", "DECLINED", "WITHDRAWN"];
  const safePage  = Math.max(1, Number(page));
  const safeLimit = Math.min(MAX_PER_PAGE, Math.max(1, Number(limit)));
  const skip      = (safePage - 1) * safeLimit;

  const statusFilter = status && VALID_STATUSES.includes(status.toUpperCase())
    ? status.toUpperCase()
    : undefined;

  const where = {
    requesterId: userId,
    ...(statusFilter && { status: statusFilter }),
  };

  const [requests, total] = await Promise.all([
    prisma.joinRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: safeLimit,
      select: {
        id: true, status: true,
        message: true, proposedHoursPerWeek: true,
        plannedTaskDeadlines: true,
        createdAt: true, reviewedAt: true, decisionNote: true,
        project: {
          select: {
            id: true, title: true, slug: true,
            status: true, projectType: true,
          },
        },
        role: { select: { id: true, title: true } },
      },
    }),
    prisma.joinRequest.count({ where }),
  ]);

  return {
    requests,
    pagination: {
      total,
      page:       safePage,
      limit:      safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}
