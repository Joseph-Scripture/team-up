import prisma from "../db/client.js";
import { createNotification } from "./notificationService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 50;

const VALID_STATUSES = ["PENDING", "ACCEPTED", "DECLINED", "WITHDRAWN"];
const ACTIVE_PROJECT_STATUSES = ["OPEN", "IN_PROGRESS"];
const UNCHANGEABLE_TASK_STATUSES = ["COMPLETED", "CANCELLED"];

// ─────────────────────────────────────────────────────────────────────────────
// Custom error
// ─────────────────────────────────────────────────────────────────────────────

export class DateExtensionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "DateExtensionError";
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared select shape
// ─────────────────────────────────────────────────────────────────────────────

const REQUEST_SELECT = {
  id: true,
  projectId: true,
  taskId: true,
  requesterId: true,
  reviewerId: true,
  currentDate: true,
  requestedDate: true,
  reason: true,
  decisionNote: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  reviewedAt: true,
  project: {
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      ownerId: true,
      startDate: true,
      targetEndDate: true,
    },
  },
  task: {
    select: {
      id: true,
      title: true,
      dueDate: true,
      status: true,
      assigneeMemberId: true,
    },
  },
  requester: {
    select: { id: true, name: true, avatarUrl: true, headline: true },
  },
  reviewer: {
    select: { id: true, name: true, avatarUrl: true },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(date) {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function targetLabel({ task, project }) {
  return task ? `"${task.title}"` : project.title;
}

function targetDescription({ task, project }) {
  return task
    ? `the deadline for "${task.title}"`
    : `the target end date for ${project.title}`;
}

/**
 * Resolve the caller's relationship to a project.
 * Returns { role: "OWNER"|"MANAGER"|"MEMBER", memberId, project }.
 * Any active member may read/request; only OWNER/MANAGER may review.
 */
async function resolveProjectAccess(userId, projectId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      ownerId: true,
      startDate: true,
      targetEndDate: true,
      memberships: {
        where: { userId, status: "ACTIVE" },
        select: { id: true, accessRole: true },
      },
    },
  });

  if (!project) throw new DateExtensionError("Project not found", 404);

  const membership = project.memberships[0];

  if (project.ownerId === userId) {
    return { role: "OWNER", memberId: membership?.id ?? null, project };
  }
  if (!membership) throw new DateExtensionError("Project not found", 404);

  return {
    role: membership.accessRole === "MANAGER" ? "MANAGER" : "MEMBER",
    memberId: membership.id,
    project,
  };
}

function isReviewer(role) {
  return role === "OWNER" || role === "MANAGER";
}

async function notifyReviewers({ request, project, task, requesterName }) {
  const projectReviewers = await prisma.project.findUnique({
    where: { id: project.id },
    select: {
      ownerId: true,
      memberships: {
        where: { status: "ACTIVE", accessRole: "MANAGER" },
        select: { userId: true },
      },
    },
  });

  if (!projectReviewers) return;

  const recipientIds = new Set([
    projectReviewers.ownerId,
    ...projectReviewers.memberships.map(({ userId }) => userId),
  ]);
  // A reviewer should not receive a notification for their own request.
  recipientIds.delete(request.requesterId);

  await Promise.all(
    [...recipientIds].map((recipientId) =>
      createNotification({
        userId: recipientId,
        type: "DATE_EXTENSION_REQUEST",
        projectId: project.id,
        entityType: "dateExtensionRequest",
        entityId: request.id,
        title: `${requesterName} requested a new date for ${targetLabel({ task, project })}`,
        message: `${requesterName} wants to move ${targetDescription({ task, project })} to ${formatDate(request.requestedDate)}. Reason: ${request.reason}`,
        data: {
          dateExtensionRequestId: request.id,
          projectSlug: project.slug,
          taskId: task?.id ?? null,
          currentDate: request.currentDate,
          requestedDate: request.requestedDate,
          reason: request.reason,
        },
        dedupeKey: `date-extension-requested:${request.id}:${recipientId}`,
      }),
    ),
  );
}

async function notifyRequesterOfDecision({
  request,
  project,
  task,
  decision,
  decisionNote,
  reviewerName,
}) {
  const accepted = decision === "ACCEPTED";
  const label = targetLabel({ task, project });
  const noteSuffix = decisionNote ? ` Note: ${decisionNote}` : "";

  await createNotification({
    userId: request.requesterId,
    type: "DATE_EXTENSION_DECIDED",
    projectId: project.id,
    entityType: "dateExtensionRequest",
    entityId: request.id,
    title: accepted
      ? `Your new date was accepted for ${label}`
      : `Your new date request was declined for ${label}`,
    message: accepted
      ? `${reviewerName} accepted ${formatDate(request.requestedDate)} as the new date for ${targetDescription({ task, project })}.${noteSuffix}`
      : `${reviewerName} declined the request to move ${targetDescription({ task, project })} to ${formatDate(request.requestedDate)}.${noteSuffix}`,
    data: {
      dateExtensionRequestId: request.id,
      projectSlug: project.slug,
      taskId: task?.id ?? null,
      status: decision,
      requestedDate: request.requestedDate,
      decisionNote: decisionNote ?? null,
    },
    dedupeKey: `date-extension-decided:${request.id}`,
  });
}

function normalizePagination({ page = 1, limit = DEFAULT_PER_PAGE } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(MAX_PER_PAGE, Math.max(1, Number(limit) || DEFAULT_PER_PAGE));
  return { safePage, safeLimit, skip: (safePage - 1) * safeLimit };
}

// ─────────────────────────────────────────────────────────────────────────────
// createDateExtensionRequest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a date extension request.
 *
 * The request targets a task deadline when `taskId` is supplied, otherwise it
 * targets the project's `targetEndDate`. Only active project members may ask,
 * and the requested date must be strictly later than the current deadline.
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {object} body
 * @param {string} [body.taskId]
 * @param {Date}   body.requestedDate
 * @param {string} body.reason
 */
export async function createDateExtensionRequest(userId, projectId, {
  taskId,
  requestedDate,
  reason,
}) {
  const { project } = await resolveProjectAccess(userId, projectId);

  if (!ACTIVE_PROJECT_STATUSES.includes(project.status)) {
    throw new DateExtensionError(
      "Date extensions can only be requested for OPEN or IN_PROGRESS projects",
      409,
    );
  }

  const proposedDate = new Date(requestedDate);
  if (Number.isNaN(proposedDate.getTime())) {
    throw new DateExtensionError("requestedDate must be a valid date", 400);
  }
  if (proposedDate <= new Date()) {
    throw new DateExtensionError("requestedDate must be in the future", 400);
  }

  let task = null;
  let currentDate = project.targetEndDate;

  if (taskId) {
    task = await prisma.task.findFirst({
      where: { id: taskId, projectId },
      select: {
        id: true,
        title: true,
        dueDate: true,
        status: true,
        assigneeMemberId: true,
      },
    });

    if (!task) throw new DateExtensionError("Task not found", 404);
    if (UNCHANGEABLE_TASK_STATUSES.includes(task.status)) {
      throw new DateExtensionError(
        "A date extension cannot be requested for a completed or cancelled task",
        409,
      );
    }
    if (!task.dueDate) {
      throw new DateExtensionError("This task has no due date to extend", 409);
    }
    currentDate = task.dueDate;
  } else if (!currentDate) {
    throw new DateExtensionError(
      "This project has no target end date to extend",
      409,
    );
  }

  if (currentDate && proposedDate <= new Date(currentDate)) {
    throw new DateExtensionError(
      `The requested date must be after the current deadline (${formatDate(currentDate)})`,
      409,
    );
  }

  const duplicate = await prisma.dateExtensionRequest.findFirst({
    where: {
      projectId,
      requesterId: userId,
      taskId: taskId ?? null,
      status: "PENDING",
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new DateExtensionError(
      "You already have a pending date extension request for this deadline",
      409,
    );
  }

  const request = await prisma.dateExtensionRequest.create({
    data: {
      projectId,
      taskId: taskId ?? null,
      requesterId: userId,
      currentDate: currentDate ?? null,
      requestedDate: proposedDate,
      reason: reason.trim(),
      status: "PENDING",
    },
    select: REQUEST_SELECT,
  });

  await notifyReviewers({
    request,
    project,
    task,
    requesterName: request.requester.name,
  });

  return request;
}

// ─────────────────────────────────────────────────────────────────────────────
// listProjectDateExtensionRequests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List date extension requests for a project (owner/manager only).
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {object} filters
 * @param {string} [filters.status]
 * @param {string} [filters.taskId]
 * @param {number} [filters.page=1]
 * @param {number} [filters.limit=20]
 */
export async function listProjectDateExtensionRequests(userId, projectId, {
  status,
  taskId,
  page,
  limit,
} = {}) {
  const { role } = await resolveProjectAccess(userId, projectId);
  if (!isReviewer(role)) {
    throw new DateExtensionError(
      "Only the project owner or a manager can view date extension requests",
      403,
    );
  }

  const { safePage, safeLimit, skip } = normalizePagination({ page, limit });
  const statusFilter = status && VALID_STATUSES.includes(status.toUpperCase())
    ? status.toUpperCase()
    : undefined;

  const where = {
    projectId,
    ...(statusFilter && { status: statusFilter }),
    ...(taskId && { taskId }),
  };

  const [requests, total] = await Promise.all([
    prisma.dateExtensionRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: safeLimit,
      select: REQUEST_SELECT,
    }),
    prisma.dateExtensionRequest.count({ where }),
  ]);

  return {
    requests,
    pagination: {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// listMyDateExtensionRequests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List date extension requests sent by the authenticated user.
 *
 * @param {string} userId
 * @param {object} filters
 * @param {string} [filters.status]
 * @param {number} [filters.page=1]
 * @param {number} [filters.limit=20]
 */
export async function listMyDateExtensionRequests(userId, { status, page, limit } = {}) {
  const { safePage, safeLimit, skip } = normalizePagination({ page, limit });
  const statusFilter = status && VALID_STATUSES.includes(status.toUpperCase())
    ? status.toUpperCase()
    : undefined;

  const where = {
    requesterId: userId,
    ...(statusFilter && { status: statusFilter }),
  };

  const [requests, total] = await Promise.all([
    prisma.dateExtensionRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: safeLimit,
      select: REQUEST_SELECT,
    }),
    prisma.dateExtensionRequest.count({ where }),
  ]);

  return {
    requests,
    pagination: {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getDateExtensionRequest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load one request. Visible to the requester and project owner/managers only.
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {string} requestId
 */
export async function getDateExtensionRequest(userId, projectId, requestId) {
  const request = await prisma.dateExtensionRequest.findFirst({
    where: { id: requestId, projectId },
    select: REQUEST_SELECT,
  });

  if (!request) throw new DateExtensionError("Date extension request not found", 404);

  const { role } = await resolveProjectAccess(userId, projectId);
  if (request.requesterId !== userId && !isReviewer(role)) {
    throw new DateExtensionError("Date extension request not found", 404);
  }

  return request;
}

// ─────────────────────────────────────────────────────────────────────────────
// updateDateExtensionRequest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decide or withdraw a date extension request.
 *
 *  - ACCEPTED / DECLINED — owner or manager only; the requested date is applied
 *    to the task/project inside the same transaction that records the decision.
 *  - WITHDRAWN          — requester only, while the request is PENDING.
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {string} requestId
 * @param {object} body
 * @param {"ACCEPTED"|"DECLINED"|"WITHDRAWN"} body.status
 * @param {string} [body.decisionNote]
 */
export async function updateDateExtensionRequest(userId, projectId, requestId, {
  status,
  decisionNote,
}) {
  const nextStatus = status?.toUpperCase();
  if (!["ACCEPTED", "DECLINED", "WITHDRAWN"].includes(nextStatus)) {
    throw new DateExtensionError(
      "status must be one of: ACCEPTED, DECLINED, WITHDRAWN",
      400,
    );
  }

  const { role } = await resolveProjectAccess(userId, projectId);

  const request = await prisma.dateExtensionRequest.findFirst({
    where: { id: requestId, projectId },
    select: REQUEST_SELECT,
  });
  if (!request) throw new DateExtensionError("Date extension request not found", 404);

  if (request.status !== "PENDING") {
    throw new DateExtensionError(
      `This request cannot be updated (current status: ${request.status.toLowerCase()})`,
      409,
    );
  }

  // ── Withdraw ──────────────────────────────────────────────────────────────
  if (nextStatus === "WITHDRAWN") {
    if (request.requesterId !== userId) {
      throw new DateExtensionError("Only the requester can withdraw this request", 403);
    }

    const { count } = await prisma.dateExtensionRequest.updateMany({
      where: { id: requestId, projectId, requesterId: userId, status: "PENDING" },
      data: { status: "WITHDRAWN" },
    });
    if (count === 0) {
      throw new DateExtensionError(
        "This request has already been reviewed or withdrawn",
        409,
      );
    }

    return prisma.dateExtensionRequest.findUnique({
      where: { id: requestId },
      select: REQUEST_SELECT,
    });
  }

  // ── Accept / decline ──────────────────────────────────────────────────────
  if (!isReviewer(role)) {
    throw new DateExtensionError(
      "Only the project owner or a manager can review date extension requests",
      403,
    );
  }
  if (request.requesterId === userId) {
    throw new DateExtensionError("You cannot review your own date extension request", 403);
  }

  if (nextStatus === "ACCEPTED") {
    if (request.task && UNCHANGEABLE_TASK_STATUSES.includes(request.task.status)) {
      throw new DateExtensionError(
        "This task is completed or cancelled and can no longer be extended",
        409,
      );
    }

    const currentDeadline = request.task
      ? request.task.dueDate
      : request.project.targetEndDate;

    if (currentDeadline && new Date(request.requestedDate) <= new Date(currentDeadline)) {
      throw new DateExtensionError(
        "The requested date is no longer after the current deadline",
        409,
      );
    }
  }

  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    // Conditional update makes review single-winner if two reviewers race.
    const { count } = await tx.dateExtensionRequest.updateMany({
      where: { id: requestId, projectId, status: "PENDING" },
      data: {
        status: nextStatus,
        reviewerId: userId,
        reviewedAt: now,
        decisionNote: decisionNote?.trim() || null,
      },
    });
    if (count === 0) {
      throw new DateExtensionError(
        "This request has already been reviewed or withdrawn",
        409,
      );
    }

    if (nextStatus === "ACCEPTED") {
      if (request.taskId) {
        await tx.task.update({
          where: { id: request.taskId },
          data: { dueDate: request.requestedDate },
        });
      } else {
        await tx.project.update({
          where: { id: projectId },
          data: { targetEndDate: request.requestedDate },
        });
      }
    }

    return tx.dateExtensionRequest.findUnique({
      where: { id: requestId },
      select: REQUEST_SELECT,
    });
  });

  await notifyRequesterOfDecision({
    request: updated,
    project: updated.project,
    task: updated.task,
    decision: nextStatus,
    decisionNote: updated.decisionNote,
    reviewerName: updated.reviewer?.name ?? "The project owner",
  });

  return updated;
}
