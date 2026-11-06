import prisma from "../db/client.js";
import { createNotification } from "./notificationService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Custom error
// ─────────────────────────────────────────────────────────────────────────────

export class ContributionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name   = "ContributionError";
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared select shape
// ─────────────────────────────────────────────────────────────────────────────

const CONTRIBUTION_SELECT = {
  id: true, title: true, description: true,
  status: true, submittedAt: true, confirmedAt: true,
  createdAt: true, updatedAt: true,
  member: {
    select: {
      id: true, accessRole: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
      role: { select: { id: true, title: true } },
    },
  },
  task: { select: { id: true, title: true } },
  evidence: {
    select: { id: true, url: true, type: true, title: true },
  },
  reviews: {
    orderBy: { createdAt: "desc" },
    select: {
      id: true, decision: true, note: true, createdAt: true,
      reviewer: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Permission helper
// ─────────────────────────────────────────────────────────────────────────────

async function resolveProjectAccess(userId, projectId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true, title: true, slug: true, ownerId: true,
      memberships: {
        where: { userId, status: "ACTIVE" },
        select: { id: true, accessRole: true },
      },
    },
  });
  if (!project) throw new ContributionError("Project not found", 404);

  const isOwner   = project.ownerId === userId;
  const membership = project.memberships[0];

  if (!isOwner && !membership) {
    throw new ContributionError("Project not found", 404);
  }

  const role = isOwner ? "OWNER"
    : membership.accessRole === "MANAGER" ? "MANAGER"
    : "MEMBER";

  return { role, memberId: membership?.id ?? null, project };
}

// ─────────────────────────────────────────────────────────────────────────────
// listContributions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List contributions on a project. Supports optional ?status filter.
 * Any active member can call this.
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {object} opts
 * @param {string} [opts.status]   — filter by ContributionStatus
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=20]
 */
export async function listContributions(userId, projectId, { status, page = 1, limit = 20 } = {}) {
  await resolveProjectAccess(userId, projectId);

  const VALID_STATUSES = ["PENDING_REVIEW", "CONFIRMED", "CHANGES_REQUESTED"];
  const safePage  = Math.max(1, Number(page));
  const safeLimit = Math.min(50, Math.max(1, Number(limit)));
  const skip      = (safePage - 1) * safeLimit;

  const where = {
    projectId,
    ...(status && VALID_STATUSES.includes(status.toUpperCase()) && {
      status: status.toUpperCase(),
    }),
  };

  const [contributions, total] = await Promise.all([
    prisma.contribution.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: safeLimit,
      select: CONTRIBUTION_SELECT,
    }),
    prisma.contribution.count({ where }),
  ]);

  return {
    contributions,
    pagination: {
      total,
      page:       safePage,
      limit:      safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getContribution
// ─────────────────────────────────────────────────────────────────────────────

export async function getContribution(userId, projectId, contributionId) {
  await resolveProjectAccess(userId, projectId);

  const contribution = await prisma.contribution.findFirst({
    where: { id: contributionId, projectId },
    select: CONTRIBUTION_SELECT,
  });

  if (!contribution) throw new ContributionError("Contribution not found", 404);
  return contribution;
}

// ─────────────────────────────────────────────────────────────────────────────
// reviewContribution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A teammate reviews a contribution — CONFIRMED or CHANGES_REQUESTED.
 *
 * Rules:
 *  - Reviewer must be an active project member
 *  - Reviewer cannot be the contributor (no self-review)
 *  - Contribution must be in PENDING_REVIEW state
 *  - Only Owner / Manager can confirm; any non-contributor member can request changes
 *  - CONFIRMED sets confirmedAt and fires CONTRIBUTION_REVIEW notification to contributor
 *  - Review is append-only — each decision is preserved in ContributionReview
 *  - A CHANGES_REQUESTED decision resets status back to PENDING_REVIEW so the
 *    contributor can resubmit
 *
 * @param {string} reviewerId
 * @param {string} projectId
 * @param {string} contributionId
 * @param {object} body
 * @param {string}  body.decision  — "CONFIRMED" | "CHANGES_REQUESTED"
 * @param {string}  [body.note]
 */
export async function reviewContribution(reviewerId, projectId, contributionId, { decision, note }) {
  const { role, memberId } = await resolveProjectAccess(reviewerId, projectId);

  const contribution = await prisma.contribution.findFirst({
    where: { id: contributionId, projectId },
    select: {
      id: true, status: true, title: true,
      member: {
        select: {
          id: true,
          userId: true,
          user: { select: { id: true, name: true } },
        },
      },
      project: { select: { id: true, title: true, slug: true, ownerId: true } },
    },
  });

  if (!contribution) throw new ContributionError("Contribution not found", 404);

  // ── Business rules ────────────────────────────────────────────────────────

  // Reviewer cannot be the contributor
  if (contribution.member.userId === reviewerId) {
    throw new ContributionError("You cannot review your own contribution", 403);
  }

  // Only Owner / Manager can CONFIRM
  if (decision === "CONFIRMED" && role === "MEMBER") {
    throw new ContributionError(
      "Only the project owner or a manager can confirm a contribution",
      403,
    );
  }

  // Contribution must be in PENDING_REVIEW state for any review action
  if (contribution.status !== "PENDING_REVIEW") {
    throw new ContributionError(
      `This contribution has already been ${contribution.status === "CONFIRMED" ? "confirmed" : "reviewed"}. ` +
      `Only PENDING_REVIEW contributions can be reviewed.`,
      409,
    );
  }

  const now = new Date();

  // ── Write review + update contribution status in one transaction ──────────
  const updated = await prisma.$transaction(async (tx) => {
    // Append the review record
    await tx.contributionReview.create({
      data: {
        contributionId,
        reviewerId,
        decision,
        note: note ?? null,
      },
    });

    // Update the contribution status and set confirmedAt when confirmed
    return tx.contribution.update({
      where: { id: contributionId },
      data: {
        status:      decision,
        confirmedAt: decision === "CONFIRMED" ? now : null,
      },
      select: CONTRIBUTION_SELECT,
    });
  });

  // ── Notify contributor (fire-and-forget) ──────────────────────────────────
  const isConfirmed = decision === "CONFIRMED";
  await createNotification({
    userId:     contribution.member.userId,
    type:       "CONTRIBUTION_REVIEW",
    projectId,
    entityType: "contribution",
    entityId:   contributionId,
    title:      isConfirmed
      ? `Your contribution was confirmed: ${contribution.title}`
      : `Changes requested on: ${contribution.title}`,
    message: isConfirmed
      ? `Your work on "${contribution.title}" has been confirmed as evidence on ${contribution.project.title}.`
      : `A reviewer has requested changes on "${contribution.title}". Check the review note.`,
    data: {
      contributionId,
      projectSlug: contribution.project.slug,
      decision,
    },
    dedupeKey: `contribution-review:${contributionId}:${decision}:${now.toISOString().slice(0, 10)}`,
  });

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// getProjectContributionSummary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the confirmed contribution summary for a project page.
 * Only CONFIRMED contributions appear — acceptance criteria: summary appears
 * only after required confirmations.
 *
 * @param {string} userId
 * @param {string} projectId
 */
export async function getProjectContributionSummary(userId, projectId) {
  await resolveProjectAccess(userId, projectId);

  const confirmed = await prisma.contribution.findMany({
    where:   { projectId, status: "CONFIRMED" },
    orderBy: { confirmedAt: "desc" },
    select: {
      id: true, title: true, description: true,
      confirmedAt: true,
      member: {
        select: {
          user: { select: { id: true, name: true, avatarUrl: true } },
          role: { select: { id: true, title: true } },
        },
      },
      task:     { select: { id: true, title: true } },
      evidence: { select: { id: true, url: true, type: true, title: true } },
    },
  });

  return { contributions: confirmed, total: confirmed.length };
}
