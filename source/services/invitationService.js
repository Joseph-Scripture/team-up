import prisma from "../db/client.js";
import {
  notifyInvitationSent,
  notifyInvitationResponded,
  notifyMemberJoined,
} from "./notificationService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const INVITATION_EXPIRY_DAYS = 7;
const INVITATIONS_PER_PAGE   = 20;
const MAX_PER_PAGE           = 50;

const ACTIVE_PROJECT_STATUSES = ["OPEN", "IN_PROGRESS"];

// ─────────────────────────────────────────────────────────────────────────────
// Custom error — controllers catch this and map it to the right HTTP status
// ─────────────────────────────────────────────────────────────────────────────

export class InvitationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name  = "InvitationError";
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Count active memberships on a role (open slots = requiredMembers - this). */
async function activeRoleMemberCount(roleId) {
  return prisma.projectMember.count({
    where: { roleId, status: "ACTIVE" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// sendInvitation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate all business rules then create a ProjectInvitation row.
 * Notifications are fired AFTER the write succeeds.
 *
 * @param {string} senderId  — authenticated user's id
 * @param {string} projectId
 * @param {object} body
 * @param {string}  body.inviteeId
 * @param {string}  body.roleId
 * @param {string}  [body.message]
 * @param {number}  [body.proposedHoursPerWeek]
 */
export async function sendInvitation(senderId, projectId, { inviteeId, roleId, message, proposedHoursPerWeek }) {

  // ── 1. Load project with sender's membership and the target role ──────────
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true, title: true, slug: true, status: true, ownerId: true,
      memberships: {
        where: { userId: senderId, status: "ACTIVE" },
        select: { accessRole: true },
      },
      roles: {
        where: { id: roleId },
        select: {
          id: true, title: true, description: true,
          hoursPerWeek: true, requiredMembers: true, status: true,
          _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
        },
      },
    },
  });

  if (!project) throw new InvitationError("Project not found", 404);

  // ── 2. Sender permission — must be OWNER or MANAGER ──────────────────────
  const senderMembership = project.memberships[0];
  const isOwner   = project.ownerId === senderId;
  const isManager = senderMembership?.accessRole === "MANAGER";
  if (!isOwner && !isManager) {
    throw new InvitationError("Only the project owner or a manager can send invitations", 403);
  }

  // ── 3. Project must be in an invitable state ──────────────────────────────
  if (!ACTIVE_PROJECT_STATUSES.includes(project.status)) {
    throw new InvitationError(
      `Invitations can only be sent for OPEN or IN_PROGRESS projects (current status: ${project.status})`,
      409,
    );
  }

  // ── 4. Role must exist, belong to this project, and still be OPEN ─────────
  const role = project.roles[0];
  if (!role) throw new InvitationError("Role not found on this project", 404);
  if (role.status !== "OPEN") {
    throw new InvitationError("This role is closed and no longer accepting members", 409);
  }

  // ── 5. Role must still have capacity ─────────────────────────────────────
  const activeMemberCount = role._count.memberships;
  if (activeMemberCount >= role.requiredMembers) {
    throw new InvitationError("This role has no remaining open slots", 409);
  }

  // ── 6. Invitee must be an active, non-deleted user ────────────────────────
  const invitee = await prisma.user.findFirst({
    where: { id: inviteeId, status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true },
  });
  if (!invitee) throw new InvitationError("Invitee not found", 404);

  // ── 7. Invitee must not already be an active member ───────────────────────
  const alreadyMember = await prisma.projectMember.findFirst({
    where: { projectId, userId: inviteeId, status: "ACTIVE" },
  });
  if (alreadyMember) {
    throw new InvitationError("This user is already an active member of the project", 409);
  }

  // ── 8. No existing PENDING invitation for this (project, invitee) pair ────
  const now = new Date();
  const pendingInvitation = await prisma.projectInvitation.findFirst({
    where: {
      projectId,
      inviteeId,
      status: "PENDING",
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    },
  });
  if (pendingInvitation) {
    throw new InvitationError("A pending invitation already exists for this user on this project", 409);
  }

  // ── 9. No existing PENDING join request for this (project, invitee) pair ──
  const pendingRequest = await prisma.joinRequest.findFirst({
    where: { projectId, requesterId: inviteeId, status: "PENDING" },
  });
  if (pendingRequest) {
    throw new InvitationError(
      "This user has already submitted a join request for this project. Accept their request instead.",
      409,
    );
  }

  // ── 10. Fetch sender name for notification ────────────────────────────────
  const sender = await prisma.user.findUnique({
    where: { id: senderId },
    select: { name: true },
  });

  // ── 11. Create the invitation ─────────────────────────────────────────────
  const expiresAt = new Date(now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const invitation = await prisma.projectInvitation.create({
    data: {
      projectId,
      inviterId:  senderId,
      inviteeId,
      roleId,
      message:             message ?? null,
      proposedHoursPerWeek: proposedHoursPerWeek ?? null,
      status:   "PENDING",
      expiresAt,
    },
    select: {
      id: true, status: true, message: true,
      proposedHoursPerWeek: true, expiresAt: true, createdAt: true,
      project: { select: { id: true, title: true, slug: true } },
      inviter: { select: { id: true, name: true, avatarUrl: true } },
      invitee: { select: { id: true, name: true, avatarUrl: true } },
      role:    { select: { id: true, title: true, description: true, hoursPerWeek: true } },
    },
  });

  // ── 12. Notify invitee (fire-and-forget, never throws) ────────────────────
  await notifyInvitationSent({
    invitation: { id: invitation.id, inviteeId },
    project:    { id: project.id, title: project.title, slug: project.slug },
    role:       { title: role.title },
    senderName: sender?.name ?? "A team member",
  });

  return invitation;
}

// ─────────────────────────────────────────────────────────────────────────────
// acceptInvitation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Accept a pending invitation. Runs in a transaction:
 *   1. Re-validates ownership, expiry, role capacity, existing membership
 *   2. Marks invitation ACCEPTED
 *   3. Creates ProjectMember row
 *   4. Closes the role if it is now full
 *
 * Notifications fired after the transaction commits.
 *
 * @param {string} userId        — authenticated invitee
 * @param {string} invitationId
 */
export async function acceptInvitation(userId, invitationId) {
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {

    // ── a. Load invitation with full context ────────────────────────────────
    const invitation = await tx.projectInvitation.findUnique({
      where: { id: invitationId },
      select: {
        id: true, inviteeId: true, inviterId: true,
        status: true, expiresAt: true, roleId: true,
        project: {
          select: {
            id: true, title: true, slug: true, status: true,
            ownerId: true, deletedAt: true,
          },
        },
        role: {
          select: {
            id: true, title: true, status: true,
            requiredMembers: true,
            _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
          },
        },
        invitee: { select: { id: true, name: true } },
        inviter: { select: { id: true, name: true } },
      },
    });

    // Serialize admissions for a role before counting memberships.
    if (invitation?.roleId) {
      await tx.$queryRaw`SELECT "id" FROM "ProjectRole" WHERE "id" = ${invitation.roleId} FOR UPDATE`;
    }

    // ── b. Ownership check ──────────────────────────────────────────────────
    if (!invitation) throw new InvitationError("Invitation not found", 404);
    if (invitation.inviteeId !== userId) throw new InvitationError("Invitation not found", 404);

    // ── c. State checks ─────────────────────────────────────────────────────
    if (invitation.status !== "PENDING") {
      throw new InvitationError(
        `This invitation has already been ${invitation.status.toLowerCase()}`,
        409,
      );
    }
    if (invitation.expiresAt && invitation.expiresAt <= now) {
      // Mark expired so it stops appearing as pending
      await tx.projectInvitation.update({
        where: { id: invitationId },
        data:  { status: "EXPIRED" },
      });
      throw new InvitationError("This invitation has expired", 410);
    }
    if (!invitation.project || invitation.project.deletedAt) {
      throw new InvitationError("The project no longer exists", 404);
    }
    if (!ACTIVE_PROJECT_STATUSES.includes(invitation.project.status)) {
      throw new InvitationError("This project is no longer accepting new members", 409);
    }

    // ── d. Re-check role capacity inside the transaction ───────────────────
    if (invitation.role.status !== "OPEN") {
      throw new InvitationError("This role has been closed since the invitation was sent", 409);
    }
    const activeMemberCount = invitation.role._count.memberships;
    if (activeMemberCount >= invitation.role.requiredMembers) {
      // Role filled since invitation was sent — expire it cleanly
      await tx.projectInvitation.update({
        where: { id: invitationId },
        data:  { status: "EXPIRED" },
      });
      throw new InvitationError(
        "This role has been filled since the invitation was sent",
        409,
      );
    }

    // ── e. Guard against duplicate membership (concurrent accepts) ──────────
    const existingMembership = await tx.projectMember.findFirst({
      where: {
        projectId: invitation.project.id,
        userId,
        status: "ACTIVE",
      },
    });
    if (existingMembership) {
      throw new InvitationError("You are already an active member of this project", 409);
    }

    // ── f. Accept invitation ────────────────────────────────────────────────
    await tx.projectInvitation.update({
      where: { id: invitationId },
      data:  { status: "ACCEPTED", respondedAt: now },
    });

    // ── g. Create membership ────────────────────────────────────────────────
    const membership = await tx.projectMember.create({
      data: {
        projectId:    invitation.project.id,
        userId,
        roleId:       invitation.roleId,
        accessRole:   "MEMBER",
        status:       "ACTIVE",
        invitationId,
        joinedAt:     now,
        endedAt:      null,
      },
    });

    // ── h. Close the role if it is now full ─────────────────────────────────
    const newCount = activeMemberCount + 1;
    if (newCount >= invitation.role.requiredMembers) {
      await tx.projectRole.update({
        where: { id: invitation.roleId },
        data:  { status: "CLOSED" },
      });
    }

    return { invitation, membership };
  });

  const { invitation, membership } = result;

  // ── Notifications (after transaction commits, never inside it) ────────────
  const project = invitation.project;
  const role    = invitation.role;

  await notifyInvitationResponded({
    invitation: { id: invitation.id, inviterId: invitation.inviterId },
    project:    { id: project.id, title: project.title, slug: project.slug },
    role:       { title: role.title },
    inviteeName: invitation.invitee.name,
    status:     "ACCEPTED",
  });

  await notifyMemberJoined({
    ownerId:      project.ownerId,
    inviterId:    invitation.inviterId,
    project:      { id: project.id, title: project.title, slug: project.slug },
    role:         { title: role.title },
    inviteeName:  invitation.invitee.name,
    membershipId: membership.id,
  });

  return {
    message:    "Invitation accepted. You are now a member of the project.",
    projectId:  project.id,
    projectSlug: project.slug,
    membershipId: membership.id,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// declineInvitation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decline a pending invitation.
 * Uses updateMany so the ownership + pending state check is one atomic operation.
 *
 * @param {string} userId        — authenticated invitee
 * @param {string} invitationId
 */
export async function declineInvitation(userId, invitationId) {
  const now = new Date();

  // Single conditional update — if count = 0, something was wrong (not theirs,
  // already responded, or expired).
  const { count } = await prisma.projectInvitation.updateMany({
    where: {
      id:        invitationId,
      inviteeId: userId,
      status:    "PENDING",
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    },
    data: { status: "DECLINED", respondedAt: now },
  });

  if (count === 0) {
    // Determine a specific reason for the 404/409 to help the client
    const invitation = await prisma.projectInvitation.findUnique({
      where:  { id: invitationId },
      select: { inviteeId: true, status: true, expiresAt: true },
    });
    if (!invitation || invitation.inviteeId !== userId) {
      throw new InvitationError("Invitation not found", 404);
    }
    if (invitation.status !== "PENDING") {
      throw new InvitationError(
        `This invitation has already been ${invitation.status.toLowerCase()}`,
        409,
      );
    }
    throw new InvitationError("This invitation has expired", 410);
  }

  // Load enough context for the notification
  const invitation = await prisma.projectInvitation.findUnique({
    where:  { id: invitationId },
    select: {
      id: true, inviterId: true,
      project: { select: { id: true, title: true, slug: true } },
      role:    { select: { title: true } },
      invitee: { select: { name: true } },
    },
  });

  // Notify the inviter (fire-and-forget)
  if (invitation) {
    await notifyInvitationResponded({
      invitation: { id: invitation.id, inviterId: invitation.inviterId },
      project:    invitation.project,
      role:       invitation.role,
      inviteeName: invitation.invitee.name,
      status:     "DECLINED",
    });
  }

  return { message: "Invitation declined." };
}

// ─────────────────────────────────────────────────────────────────────────────
// listMyInvitations  (invitee view)
// ─────────────────────────────────────────────────────────────────────────────

const VALID_STATUSES = ["PENDING", "ACCEPTED", "DECLINED", "CANCELLED", "EXPIRED"];

/**
 * Return paginated invitations received by the authenticated user.
 *
 * @param {string} userId
 * @param {object} opts
 * @param {string} [opts.status="PENDING"]
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=20]
 */
export async function listMyInvitations(userId, { status = "PENDING", page = 1, limit = INVITATIONS_PER_PAGE } = {}) {
  const safePage  = Math.max(1, Number(page));
  const safeLimit = Math.min(MAX_PER_PAGE, Math.max(1, Number(limit)));
  const skip      = (safePage - 1) * safeLimit;

  const statusFilter = VALID_STATUSES.includes(status?.toUpperCase())
    ? status.toUpperCase()
    : "PENDING";

  const now = new Date();

  // For PENDING, also exclude expired ones so the list stays honest
  const where = {
    inviteeId: userId,
    status:    statusFilter,
    project:   { deletedAt: null },
    ...(statusFilter === "PENDING" && {
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    }),
  };

  const [invitations, total] = await Promise.all([
    prisma.projectInvitation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: safeLimit,
      select: {
        id: true, status: true, message: true,
        proposedHoursPerWeek: true, expiresAt: true,
        createdAt: true, respondedAt: true,
        project: {
          select: {
            id: true, title: true, slug: true,
            description: true, status: true, durationWeeks: true,
          },
        },
        inviter: { select: { id: true, name: true, avatarUrl: true } },
        role: {
          select: {
            id: true, title: true, description: true, hoursPerWeek: true,
          },
        },
      },
    }),
    prisma.projectInvitation.count({ where }),
  ]);

  return {
    invitations,
    pagination: {
      total,
      page:       safePage,
      limit:      safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// listProjectInvitations  (owner / manager view)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return all invitations sent on a specific project (owner/manager view).
 * Optionally filter by status and/or roleId.
 *
 * @param {string} requesterId  — must be owner or manager
 * @param {string} projectId
 * @param {object} opts
 * @param {string} [opts.status]
 * @param {string} [opts.roleId]
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=20]
 */
export async function listProjectInvitations(requesterId, projectId, { status, roleId, page = 1, limit = INVITATIONS_PER_PAGE } = {}) {
  // Permission check
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

  if (!project) throw new InvitationError("Project not found", 404);

  const isOwner   = project.ownerId === requesterId;
  const isManager = project.memberships[0]?.accessRole === "MANAGER";
  if (!isOwner && !isManager) {
    throw new InvitationError("Only the project owner or a manager can view project invitations", 403);
  }

  const safePage  = Math.max(1, Number(page));
  const safeLimit = Math.min(MAX_PER_PAGE, Math.max(1, Number(limit)));
  const skip      = (safePage - 1) * safeLimit;

  const statusFilter = status && VALID_STATUSES.includes(status.toUpperCase())
    ? status.toUpperCase()
    : undefined;

  const where = {
    projectId,
    ...(statusFilter && { status: statusFilter }),
    ...(roleId       && { roleId }),
  };

  const [invitations, total] = await Promise.all([
    prisma.projectInvitation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: safeLimit,
      select: {
        id: true, status: true, message: true,
        proposedHoursPerWeek: true, expiresAt: true,
        createdAt: true, respondedAt: true,
        invitee: { select: { id: true, name: true, avatarUrl: true } },
        inviter: { select: { id: true, name: true, avatarUrl: true } },
        role: { select: { id: true, title: true } },
      },
    }),
    prisma.projectInvitation.count({ where }),
  ]);

  return {
    invitations,
    pagination: {
      total,
      page:       safePage,
      limit:      safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// findCollaborators  (project owner / manager view)
// ─────────────────────────────────────────────────────────────────────────────

const COLLABORATORS_PER_PAGE = 20;

// Valid ProjectType enum values from the Prisma schema.
const VALID_PROJECT_TYPES = [
  "WEB_APPLICATION",
  "MOBILE_APP",
  "DESKTOP_APP",
  "API_SERVICE",
  "DATA_SCIENCE",
  "DESIGN",
  "OTHER",
];

/**
 * Find eligible users that a project owner / manager can invite for a specific
 * open role. Applies optional filters from the "Find Collaborators" screen and
 * returns the user list plus a total count.
 *
 * Hard exclusions (applied regardless of optional filters):
 *  - User must be ACTIVE and not soft-deleted
 *  - User must have completed onboarding
 *  - User must not already be an ACTIVE member of the project
 *  - User must not already have a PENDING invitation to this project
 *  - User must not already have a PENDING join request for this project
 *  - The requester must be the project owner or a MANAGER
 *
 * Optional filters (any combination):
 *  - skills        {string[]} — skill IDs; user must have at least one
 *  - projectType   {string}   — enum value; matched against user's past project memberships
 *  - durationWeeks {number}   — matched against user.preferredProjectDurationWeeks (±4 weeks)
 *  - weeklyHours   {number}   — user.weeklyAvailabilityHours must be >= half this value
 *
 * @param {string} requesterId — authenticated user (must be owner or manager)
 * @param {string} projectId
 * @param {string} roleId      — the role being filled (required)
 * @param {object} filters
 * @param {string[]} [filters.skills]
 * @param {string}   [filters.projectType]
 * @param {number}   [filters.durationWeeks]
 * @param {number}   [filters.weeklyHours]
 * @param {number}   [filters.page=1]
 * @param {number}   [filters.limit=20]
 */
export async function findCollaborators(
  requesterId,
  projectId,
  roleId,
  { skills = [], projectType, durationWeeks, weeklyHours, page = 1, limit = COLLABORATORS_PER_PAGE } = {},
) {
  // ── 1. Permission check — load project ───────────────────────────────────
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

  if (!project) throw new InvitationError("Project not found", 404);

  const isOwner   = project.ownerId === requesterId;
  const isManager = project.memberships[0]?.accessRole === "MANAGER";
  if (!isOwner && !isManager) {
    throw new InvitationError(
      "Only the project owner or a manager can search for collaborators",
      403,
    );
  }

  // ── 2. Validate the role belongs to this project and is OPEN ─────────────
  const role = await prisma.projectRole.findFirst({
    where: { id: roleId, projectId },
    select: { id: true, title: true, hoursPerWeek: true, status: true },
  });

  if (!role) throw new InvitationError("Role not found on this project", 404);
  if (role.status !== "OPEN") {
    throw new InvitationError("This role is closed and no longer accepting members", 409);
  }

  // ── 3. Build user filter ──────────────────────────────────────────────────
  const safePage  = Math.max(1, Number(page));
  const safeLimit = Math.min(MAX_PER_PAGE, Math.max(1, Number(limit)));
  const skip      = (safePage - 1) * safeLimit;

  // Normalise skill IDs array — remove falsy/blank values
  const skillIds = (Array.isArray(skills) ? skills : [skills])
    .map((s) => String(s).trim())
    .filter(Boolean);

  // Effective hours threshold: user must be able to commit at least half the
  // role's required hours (mirrors the hard-filter logic from the scoring engine).
  // If weeklyHours is explicitly passed in the query, that overrides the role's
  // own hoursPerWeek value, letting the owner tighten the filter from the UI.
  const hoursThreshold = weeklyHours != null
    ? Math.floor(Number(weeklyHours) / 2)
    : role.hoursPerWeek != null
      ? Math.floor(role.hoursPerWeek / 2)
      : null;

  // Duration range: ±4 weeks around the selected preference
  const durWeeks = durationWeeks != null ? Number(durationWeeks) : null;

  // Build the AND conditions array to safely compose filters that touch the
  // same relation (memberships) without overwriting each other via object spread.
  const andConditions = [
    // Hard exclusion: not an active member of this project
    { memberships: { none: { projectId, status: "ACTIVE" } } },
  ];

  // Optional: project type filter — kept in AND so it does not collide with the
  // memberships: none exclusion above (both reference the same relation).
  if (projectType && VALID_PROJECT_TYPES.includes(projectType.toUpperCase())) {
    andConditions.push({
      memberships: {
        some: {
          status:  "ACTIVE",
          project: { projectType: projectType.toUpperCase() },
        },
      },
    });
  }

  const where = {
    // Base requirements
    status:                "ACTIVE",
    deletedAt:             null,
    onboardingCompletedAt: { not: null },

    // Hard exclusions (relations that don't conflict with the AND array)
    receivedInvitations: { none: { projectId, status: "PENDING" } },
    joinRequests:        { none: { projectId, status: "PENDING" } },

    // Compose membership conditions safely via AND
    AND: andConditions,

    // Optional: skill filter — user must possess at least one of the given skills
    ...(skillIds.length > 0 && {
      skills: { some: { skillId: { in: skillIds } } },
    }),

    // Optional: availability filter — user can commit at least half the required hours
    ...(hoursThreshold != null && {
      weeklyAvailabilityHours: { gte: hoursThreshold },
    }),

    // Optional: duration preference filter — user prefers a project length close
    // to the selected value (±4 weeks tolerance)
    ...(durWeeks != null && {
      preferredProjectDurationWeeks: {
        gte: Math.max(1, durWeeks - 4),
        lte: durWeeks + 4,
      },
    }),
  };

  // ── 4. Query users + count in parallel ───────────────────────────────────
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ isAvailable: "desc" }, { createdAt: "desc" }],
      skip,
      take: safeLimit,
      select: {
        id:                            true,
        name:                          true,
        headline:                      true,
        avatarUrl:                     true,
        location:                      true,
        isAvailable:                   true,
        weeklyAvailabilityHours:       true,
        preferredProjectDurationWeeks: true,
        skills: {
          select: {
            level: true,
            skill: { select: { id: true, name: true, slug: true, category: true } },
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    count: total,
    role:  { id: role.id, title: role.title },
    users,
    pagination: {
      total,
      page:       safePage,
      limit:      safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}
