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
  memberAcknowledgedAt: true,
  createdAt: true, updatedAt: true,
  member: {
    select: {
      id: true, accessRole: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
      role: { select: { id: true, title: true } },
    },
  },
  evidence: {
    select: { id: true, taskId: true, url: true, type: true, title: true },
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
// Reviewer notifications ("please-review" ping)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-app "please-review" ping to everyone who can actually confirm a
 * contribution: the project owner plus every ACTIVE manager, excluding the
 * contributor themself. Notifications are in-app only for now — no email.
 * Never throws (createNotification is fire-and-forget).
 *
 * @param {object} opts
 * @param {object} opts.project         — { id, title, slug, ownerId }
 * @param {string} opts.contributionId
 * @param {string} opts.title           — contribution title
 * @param {object} opts.contributor     — { userId, user: { name } }
 * @param {"submit"|"resubmit"|"acknowledge"} opts.action
 */
async function notifyReviewers({ project, contributionId, title, contributor, action }) {
  const managers = await prisma.projectMember.findMany({
    where: { projectId: project.id, status: "ACTIVE", accessRole: "MANAGER" },
    select: { userId: true },
  });

  // Owner + managers, never the contributor.
  const reviewerIds = new Set([project.ownerId, ...managers.map((m) => m.userId)]);
  reviewerIds.delete(contributor.userId);

  const contributorName = contributor.user?.name ?? "A team member";
  const now = new Date();

  const MESSAGES = {
    submit: {
      title:   `New contribution awaiting review: ${title}`,
      message: `${contributorName} submitted a contribution on ${project.title}.`,
    },
    resubmit: {
      title:   `Updated contribution awaiting review: ${title}`,
      message: `${contributorName} updated their contribution after requested changes on ${project.title} — please review it again.`,
    },
    acknowledge: {
      title:   `Contribution ready for review: ${title}`,
      message: `${contributorName} marked their contribution on ${project.title} ready for review.`,
    },
  };

  await Promise.all(
    [...reviewerIds].map((userId) =>
      createNotification({
        userId,
        type:       "CONTRIBUTION_SUBMITTED",
        projectId:  project.id,
        entityType: "contribution",
        entityId:   contributionId,
        title:      MESSAGES[action].title,
        message:    MESSAGES[action].message,
        data:       { contributionId, projectSlug: project.slug, action },
        dedupeKey:  `contribution-submitted:${contributionId}:${action}:${now.toISOString()}`,
      }),
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// listContributions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List contributions on a project. Supports optional ?status filter and
 * ?mine=true (only the caller's own contributions).
 * Any active member can call this.
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {object} opts
 * @param {string} [opts.status]   — filter by ContributionStatus
 * @param {boolean} [opts.mine]    — only the caller's own contributions
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=20]
 */
export async function listContributions(userId, projectId, { status, mine, page = 1, limit = 20 } = {}) {
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
    ...(mine === true || mine === "true" ? {
      member: { userId },
    } : {}),
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
// submitContribution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the member's ONE contribution summary for this project.
 *
 * One summary per member per project — if one already exists the call is a
 * 409: further work is recorded as evidence on that summary (task completions
 * are appended automatically; manual links go through
 * POST /:contributionId/evidence).
 *
 * The submission is the first of the two steps: the member reviews their own
 * summary (acknowledgeContribution) and then a teammate confirms it.
 * Fires an in-app CONTRIBUTION_SUBMITTED "please-review" ping to the owner
 * and managers (never the contributor).
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {object} body
 * @param {string}  body.title
 * @param {string} [body.description]
 * @param {string} [body.artifactUrl]  — external link (repo, demo, …)
 * @param {string} [body.fileUrl]      — Cloudinary file url from POST /api/uploads
 * @param {string} [body.fileType]     — evidence type for the uploaded file
 */
export async function submitContribution(userId, projectId, body) {
  const { memberId, project } = await resolveProjectAccess(userId, projectId);
  if (!memberId) {
    throw new ContributionError("Only project members can submit a contribution", 403);
  }

  const { title, description, artifactUrl, fileUrl, fileType } = body;

  // One summary per member per project.
  const existing = await prisma.contribution.findUnique({
    where:  { projectId_memberId: { projectId, memberId } },
    select: { id: true },
  });
  if (existing) {
    throw new ContributionError(
      "You already have a contribution summary on this project — add evidence to it instead of creating a new one",
      409,
    );
  }

  const evidence = [];
  if (artifactUrl) {
    evidence.push({ url: artifactUrl, type: "LIVE_DEMO", title: "Artifact link" });
  }
  if (fileUrl) {
    evidence.push({ url: fileUrl, type: fileType ?? "DOCUMENT", title: "Attached file" });
  }

  const contribution = await prisma.contribution.create({
    data: {
      projectId,
      memberId,
      title: title.trim(),
      description: description ?? null,
      status: "PENDING_REVIEW",
      // The member still has to review their own summary.
      memberAcknowledgedAt: null,
      evidence: evidence.length > 0 ? { create: evidence } : undefined,
    },
    select: CONTRIBUTION_SELECT,
  });

  // "Please-review" ping — owner + managers, in-app only.
  await notifyReviewers({
    project,
    contributionId: contribution.id,
    title:          contribution.title,
    contributor:    contribution.member,
    action:         "submit",
  });

  return contribution;
}

// ─────────────────────────────────────────────────────────────────────────────
// recordTaskCompletion — append a completed task to the member's summary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called from taskService INSIDE its update transaction when a task
 * transitions to COMPLETED. Upserts the member's one-per-project summary and
 * appends a TASK_COMPLETION evidence entry for the task.
 *
 * Deliberately silent and status-preserving:
 *  - a CONFIRMED summary stays CONFIRMED (new work appends to confirmed work)
 *  - a PENDING_REVIEW summary stays pending (reviewers were already pinged)
 *  - memberAcknowledgedAt is never touched
 *  - no notifications are sent
 *
 * Idempotent per task: reopening and re-completing a task never duplicates
 * its evidence entry.
 *
 * @param {object} tx        — the surrounding Prisma transaction client
 * @param {object} opts
 * @param {string} opts.projectId
 * @param {string} opts.memberId        — the contributing member
 * @param {string} opts.taskId
 * @param {string} opts.taskTitle
 * @param {string} opts.defaultSummaryTitle — used only when the summary is created
 * @param {string} [opts.completionNote] — opening description / appended note
 * @param {string} [opts.artifactUrl]
 * @param {string} [opts.fileUrl]
 * @param {string} [opts.fileType]
 * @returns {Promise<object>} the summary — { id, title, status, evidence }
 */
export async function recordTaskCompletion(tx, {
  projectId, memberId, taskId, taskTitle,
  defaultSummaryTitle, completionNote,
  artifactUrl, fileUrl, fileType,
}) {
  let summary = await tx.contribution.findUnique({
    where:  { projectId_memberId: { projectId, memberId } },
    select: { id: true, title: true, status: true, description: true },
  });

  if (!summary) {
    // First piece of work on this project — open the summary.
    summary = await tx.contribution.create({
      data: {
        projectId,
        memberId,
        title:       defaultSummaryTitle.slice(0, 200),
        description: completionNote ?? null,
        status:      "PENDING_REVIEW",
        memberAcknowledgedAt: null,
      },
      select: { id: true, title: true, status: true, description: true },
    });
    completionNote = null; // consumed as the opening description
  }

  // The completed task itself (idempotent per task).
  const existingEntry = await tx.contributionEvidence.findFirst({
    where:  { contributionId: summary.id, taskId },
    select: { id: true },
  });
  if (!existingEntry) {
    await tx.contributionEvidence.create({
      data: {
        contributionId: summary.id,
        taskId,
        type:  "TASK_COMPLETION",
        title: taskTitle,
        url:   null,
      },
    });
  }

  // Extra links supplied with the completion — appended (not replaced),
  // and de-duplicated against links already on the summary.
  const wantedLinks = [];
  if (artifactUrl) wantedLinks.push({ url: artifactUrl, type: "LIVE_DEMO", title: "Artifact link" });
  if (fileUrl)     wantedLinks.push({ url: fileUrl, type: fileType ?? "DOCUMENT", title: "Attached file" });

  if (wantedLinks.length > 0) {
    const existingLinks = await tx.contributionEvidence.findMany({
      where:  { contributionId: summary.id, url: { in: wantedLinks.map((l) => l.url) } },
      select: { url: true },
    });
    const seen = new Set(existingLinks.map((l) => l.url));
    const fresh = wantedLinks.filter((l) => !seen.has(l.url));
    if (fresh.length > 0) {
      await tx.contributionEvidence.createMany({
        data: fresh.map((l) => ({ contributionId: summary.id, ...l })),
      });
    }
  }

  // A completion note rides along on the summary description.
  if (completionNote) {
    await tx.contribution.update({
      where: { id: summary.id },
      data: {
        description: summary.description
          ? `${summary.description}\n\n${completionNote}`
          : completionNote,
      },
    });
  }

  return tx.contribution.findUnique({
    where:  { id: summary.id },
    select: {
      id: true, title: true, status: true,
      evidence: {
        select: { id: true, taskId: true, url: true, type: true, title: true },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// acknowledgeContribution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The contributor reviews their own contribution summary.
 *
 * Only the member the contribution belongs to can acknowledge it. Until a
 * summary is acknowledged, no teammate is allowed to confirm it.
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {string} contributionId
 */
export async function acknowledgeContribution(userId, projectId, contributionId) {
  const { project } = await resolveProjectAccess(userId, projectId);

  const contribution = await prisma.contribution.findFirst({
    where: { id: contributionId, projectId },
    select: {
      id: true, status: true, title: true,
      memberAcknowledgedAt: true,
      member: { select: { id: true, userId: true, user: { select: { id: true, name: true } } } },
      // A review already on file means this is a re-acknowledge after a
      // changes-requested cycle — reviewers need a fresh "please-review" ping.
      reviews: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { decision: true },
      },
    },
  });

  if (!contribution) throw new ContributionError("Contribution not found", 404);

  if (contribution.member.userId !== userId) {
    throw new ContributionError(
      "Only the contributor can acknowledge their own summary",
      403,
    );
  }

  if (contribution.status === "CONFIRMED") {
    throw new ContributionError("This contribution is already confirmed", 409);
  }

  // Idempotent — acknowledging twice is harmless.
  if (contribution.memberAcknowledgedAt) {
    const current = await prisma.contribution.findUnique({
      where: { id: contributionId },
      select: CONTRIBUTION_SELECT,
    });
    return current;
  }

  const updated = await prisma.contribution.update({
    where: { id: contributionId },
    data:  { memberAcknowledgedAt: new Date() },
    select: CONTRIBUTION_SELECT,
  });

  // Only ping on a re-acknowledge (there is review history) — a first-time
  // acknowledgement has no review cycle to resume.
  if (contribution.reviews.length > 0) {
    await notifyReviewers({
      project,
      contributionId,
      title:       contribution.title,
      contributor: contribution.member,
      action:      "acknowledge",
    });
  }

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// editContribution — edit & resubmit after CHANGES_REQUESTED
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Edit a contribution and put it back in the review queue after a reviewer
 * requested changes. This is the resubmission flow: content is updated, the
 * acknowledgement is cleared (the contributor must acknowledge the revised
 * summary again), and reviewers get a "please-review" ping.
 *
 * Rules:
 *  - Only the contributor can edit their own contribution (403)
 *  - The latest review decision must be CHANGES_REQUESTED (409) — a fresh
 *    PENDING_REVIEW contribution has nothing to resubmit, and a CONFIRMED
 *    one is final
 *  - Evidence rows are only rebuilt when artifactUrl/fileUrl is present in
 *    the request; a title-only edit keeps existing evidence
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {string} contributionId
 * @param {object} body
 * @param {string} [body.title]
 * @param {string} [body.description]
 * @param {string} [body.artifactUrl]
 * @param {string} [body.fileUrl]
 * @param {string} [body.fileType]
 */
export async function editContribution(userId, projectId, contributionId, body) {
  const { project } = await resolveProjectAccess(userId, projectId);

  const contribution = await prisma.contribution.findFirst({
    where: { id: contributionId, projectId },
    select: {
      id: true, title: true, status: true,
      member: {
        select: { id: true, userId: true, user: { select: { id: true, name: true } } },
      },
      reviews: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { decision: true },
      },
    },
  });

  if (!contribution) throw new ContributionError("Contribution not found", 404);

  if (contribution.member.userId !== userId) {
    throw new ContributionError(
      "Only the contributor can edit their own contribution",
      403,
    );
  }

  if (contribution.status === "CONFIRMED") {
    throw new ContributionError(
      "This contribution is already confirmed and can no longer be edited",
      409,
    );
  }

  const latestReview = contribution.reviews[0];
  if (!latestReview || latestReview.decision !== "CHANGES_REQUESTED") {
    throw new ContributionError(
      "Only a contribution with requested changes can be edited and resubmitted",
      409,
    );
  }

  const { title, description, artifactUrl, fileUrl, fileType } = body;

  // Rebuild evidence only when the request carries evidence fields — a
  // title-only edit must not wipe the evidence already attached.
  const hasEvidenceUpdate = "artifactUrl" in body || "fileUrl" in body;
  const evidence = [];
  if (hasEvidenceUpdate) {
    if (artifactUrl) {
      evidence.push({ url: artifactUrl, type: "LIVE_DEMO", title: "Artifact link" });
    }
    if (fileUrl) {
      evidence.push({ url: fileUrl, type: fileType ?? "DOCUMENT", title: "Attached file" });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (hasEvidenceUpdate) {
      // Only replace the member's manual links — TASK_COMPLETION entries
      // document completed tasks and must survive a resubmission.
      await tx.contributionEvidence.deleteMany({
        where: { contributionId, type: { not: "TASK_COMPLETION" } },
      });
    }

    // Resubmission: back to PENDING_REVIEW with the acknowledgement cleared —
    // the contributor acknowledges the revised summary again, then a reviewer
    // confirms it. The CHANGES_REQUESTED decision stays in the review history.
    return tx.contribution.update({
      where: { id: contributionId },
      data: {
        ...(title       !== undefined && { title: title.trim() }),
        ...(description !== undefined && { description: description ?? null }),
        status: "PENDING_REVIEW",
        memberAcknowledgedAt: null,
        ...(hasEvidenceUpdate && evidence.length > 0 && { evidence: { create: evidence } }),
      },
      select: CONTRIBUTION_SELECT,
    });
  });

  // "Please-review" ping — owner + managers, in-app only.
  await notifyReviewers({
    project,
    contributionId,
    title:       updated.title,
    contributor: contribution.member,
    action:      "resubmit",
  });

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// addContributionEvidence — manual evidence link on the summary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The contributor attaches an extra evidence link (repo, demo, doc, …) to
 * their own summary. Silent by design: it never changes the summary status,
 * never clears the acknowledgement, and never notifies reviewers.
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {string} contributionId
 * @param {object} body
 * @param {string}  body.url
 * @param {string} [body.title]
 * @param {string} [body.type]     — EvidenceType (manual types only)
 */
export async function addContributionEvidence(userId, projectId, contributionId, body) {
  await resolveProjectAccess(userId, projectId);

  const contribution = await prisma.contribution.findFirst({
    where: { id: contributionId, projectId },
    select: {
      id: true, status: true,
      member: { select: { userId: true } },
    },
  });
  if (!contribution) throw new ContributionError("Contribution not found", 404);

  if (contribution.member.userId !== userId) {
    throw new ContributionError(
      "Only the contributor can add evidence to their own summary",
      403,
    );
  }

  const { title, url, type } = body;

  const evidence = await prisma.contributionEvidence.create({
    data: {
      contributionId,
      title: title?.trim() ?? null,
      url,
      type:  type ?? "OTHER",
    },
    select: {
      id: true, taskId: true, title: true, url: true, type: true, createdAt: true,
    },
  });

  return { evidence };
}

// ─────────────────────────────────────────────────────────────────────────────
// reviewContribution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A teammate reviews a contribution — CONFIRMED or CHANGES_REQUESTED.
 *
 * Rules:
 *  - Reviewer must be an active project member
 *  - Reviewer cannot be the contributor (no self-review) — exception: the
 *    project OWNER may always confirm their own contribution, because no
 *    reviewer above them exists. Managers and members never can.
 *  - The contributor must have acknowledged their own summary first
 *    (memberAcknowledgedAt) before a CONFIRMED decision is accepted —
 *    skipped for the owner's self-review
 *  - Contribution must be in PENDING_REVIEW state
 *  - Only Owner / Manager can confirm; any non-contributor member can request changes
 *  - CONFIRMED sets confirmedAt and fires CONTRIBUTION_REVIEW notification to contributor
 *  - Review is append-only — each decision is preserved in ContributionReview
 *  - A CHANGES_REQUESTED decision resets status back to PENDING_REVIEW (and
 *    clears the acknowledgement) so the contributor can resubmit via
 *    PATCH /contributions/:contributionId
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
      memberAcknowledgedAt: true,
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

  // Reviewer cannot be the contributor — with one exception: the project
  // OWNER may always confirm their own contribution (in any project size),
  // because no eligible reviewer exists above them. Managers and plain
  // members can never review their own work.
  const isSelfReview = contribution.member.userId === reviewerId;
  if (isSelfReview && role !== "OWNER") {
    throw new ContributionError("You cannot review your own contribution", 403);
  }

  // Only Owner / Manager can CONFIRM
  if (decision === "CONFIRMED" && role === "MEMBER") {
    throw new ContributionError(
      "Only the project owner or a manager can confirm a contribution",
      403,
    );
  }

  // The member has to review their own summary before a teammate confirms it.
  // Skipped when the owner confirms their own contribution — there is no
  // separate teammate to perform the acknowledgement.
  if (decision === "CONFIRMED" && !contribution.memberAcknowledgedAt && !isSelfReview) {
    throw new ContributionError(
      "The contributor has not acknowledged this summary yet — ask them to review it first",
      409,
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

    // Update the contribution status and set confirmedAt when confirmed.
    // Asking for changes puts the contribution back into PENDING_REVIEW and
    // clears the acknowledgement — the member reviews the revised summary
    // again and a teammate confirms it afterwards. The CHANGES_REQUESTED
    // decision itself stays in the append-only review history.
    return tx.contribution.update({
      where: { id: contributionId },
      data: {
        status:      decision === "CONFIRMED" ? "CONFIRMED" : "PENDING_REVIEW",
        confirmedAt: decision === "CONFIRMED" ? now : null,
        ...(decision === "CHANGES_REQUESTED" && { memberAcknowledgedAt: null }),
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
      evidence: {
        select: { id: true, taskId: true, url: true, type: true, title: true },
      },
    },
  });

  return { contributions: confirmed, total: confirmed.length };
}
