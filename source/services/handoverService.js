import prisma from "../db/client.js";
import { createNotification } from "./notificationService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Task handover requests
//
// "Hand it over" (from the overdue prompt) only sends a REQUEST. It never
// changes the task owner. The project owner then reassigns the task manually,
// and only that reassignment changes the task owner.
//
// A request that is still PENDING when the owner reassigns the task is
// resolved as ACCEPTED.
// ─────────────────────────────────────────────────────────────────────────────

export class HandoverError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name   = "HandoverError";
    this.status = status;
  }
}

const OPEN_TASK_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"];

const REQUEST_SELECT = {
  id: true, status: true, note: true,
  requesterId: true, requesterMemberId: true,
  createdAt: true, decidedAt: true,
  requester: { select: { id: true, name: true, avatarUrl: true } },
  requesterMember: { select: { id: true, accessRole: true } },
  task: { select: { id: true, title: true, status: true, dueDate: true } },
  decidedBy: { select: { id: true, name: true } },
};

/**
 * Load the project and the caller's role on it.
 */
async function resolveAccess(userId, projectId) {
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

  if (!project) throw new HandoverError("Project not found", 404);

  const isOwner = project.ownerId === userId;
  const membership = project.memberships[0];
  if (!isOwner && !membership) throw new HandoverError("Project not found", 404);

  const role = isOwner ? "OWNER"
    : membership.accessRole === "MANAGER" ? "MANAGER"
    : "MEMBER";

  return { project, role, memberId: membership?.id ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// requestHandover
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The current owner of a task asks for it to be handed over.
 *
 * This only sends a request — the task owner does NOT change here.
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {string} taskId
 * @param {string} [note] — why the handover is needed
 */
export async function requestHandover(userId, projectId, taskId, note) {
  const { project, memberId } = await resolveAccess(userId, projectId);

  if (!memberId) {
    throw new HandoverError("Only project members can request a handover", 403);
  }

  const task = await prisma.task.findFirst({
    where: { id: taskId, projectId },
    select: {
      id: true, title: true, status: true, dueDate: true,
      assigneeMemberId: true,
      assignee: { select: { id: true, userId: true } },
    },
  });

  if (!task) throw new HandoverError("Task not found", 404);

  if (!task.assigneeMemberId) {
    throw new HandoverError("This task has no owner to hand over", 409);
  }

  // Only the member who currently owns the task may ask for it.
  if (task.assigneeMemberId !== memberId) {
    throw new HandoverError(
      "Only the owner of the task can request a handover",
      403,
    );
  }

  if (!OPEN_TASK_STATUSES.includes(task.status)) {
    throw new HandoverError("This task is closed — there is nothing to hand over", 409);
  }

  const existing = await prisma.taskHandoverRequest.findFirst({
    where: { taskId, status: "PENDING" },
    select: { id: true },
  });
  if (existing) {
    throw new HandoverError(
      "A handover request for this task is already waiting for the project owner",
      409,
    );
  }

  const request = await prisma.taskHandoverRequest.create({
    data: {
      projectId,
      taskId,
      requesterMemberId: memberId,
      requesterId: userId,
      status: "PENDING",
      note: note ?? null,
    },
    select: REQUEST_SELECT,
  });

  // Tell the project owner — they are the one who decides.
  await createNotification({
    userId:     project.ownerId,
    type:       "TASK_HANDOVER_REQUEST",
    projectId,
    entityType: "taskHandoverRequest",
    entityId:   request.id,
    title:      `Handover requested: ${task.title}`,
    message:    `A team member asked to hand over "${task.title}" on ${project.title}.`,
    data: {
      taskId:      task.id,
      requestId:   request.id,
      projectSlug: project.slug,
    },
    dedupeKey: `handover-request:${request.id}`,
  });

  return request;
}

// ─────────────────────────────────────────────────────────────────────────────
// listHandoverRequests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List the handover requests of a project.
 *
 * Owner **and** managers can read the queue: a manager triages the requests
 * and can decline them, but only the owner can accept one (accepting transfers
 * ownership of the task, which is owner-only).
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {object} [opts]
 * @param {string} [opts.status] — defaults to PENDING
 */
export async function listHandoverRequests(userId, projectId, { status } = {}) {
  const { project, role } = await resolveAccess(userId, projectId);

  if (role !== "OWNER" && role !== "MANAGER") {
    throw new HandoverError(
      "Only the project owner or a manager can see the handover requests",
      403,
    );
  }

  const statusFilter = status ? status.toUpperCase() : "PENDING";

  const requests = await prisma.taskHandoverRequest.findMany({
    where: { projectId, status: statusFilter },
    orderBy: { createdAt: "desc" },
    select: REQUEST_SELECT,
  });

  return { requests, projectId: project.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// declineHandover
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decline a handover request. The task keeps its owner.
 *
 * Owner and managers may decline — declining never reassigns anything, so it
 * does not need to be owner-only.
 */
export async function declineHandover(userId, projectId, requestId) {
  const { project, role } = await resolveAccess(userId, projectId);

  if (role !== "OWNER" && role !== "MANAGER") {
    throw new HandoverError(
      "Only the project owner or a manager can decide a handover request",
      403,
    );
  }

  const request = await prisma.taskHandoverRequest.findFirst({
    where: { id: requestId, projectId },
    select: REQUEST_SELECT,
  });

  if (!request) throw new HandoverError("Handover request not found", 404);
  if (request.status !== "PENDING") {
    throw new HandoverError("This handover request has already been decided", 409);
  }

  const declined = await prisma.taskHandoverRequest.update({
    where: { id: requestId },
    data: {
      status:      "DECLINED",
      decidedById: userId,
      decidedAt:   new Date(),
    },
    select: REQUEST_SELECT,
  });

  await createNotification({
    userId:     request.requesterId,
    type:       "TASK_HANDOVER_DECIDED",
    projectId,
    entityType: "taskHandoverRequest",
    entityId:   request.id,
    title:      `Handover declined: ${request.task.title}`,
    message:    `The project owner declined the handover of "${request.task.title}". You keep the task.`,
    data: {
      taskId:    request.task.id,
      requestId: request.id,
      decision:  "DECLINED",
    },
    dedupeKey: `handover-decided:${request.id}:declined`,
  });

  return declined;
}

// ─────────────────────────────────────────────────────────────────────────────
// acceptHandover
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The project owner accepts a handover request and names the new owner.
 *
 * Accepting IS the reassignment: the task owner changes here, which is why only
 * the **owner** may accept (managers can read and decline requests, but they
 * cannot transfer ownership). `assigneeMemberId` must be an ACTIVE member of
 * the project and must differ from the requester — keeping the same person on
 * the task is a decline, not an accept.
 *
 * The request is resolved as ACCEPTED in the same transaction, so a failure
 * never leaves an accepted request without a reassignment (or the reverse).
 *
 * @param {string} userId            — the owner accepting
 * @param {string} projectId
 * @param {string} requestId
 * @param {object} body
 * @param {string}  body.assigneeMemberId — the new owner (ProjectMember.id)
 * @param {string} [body.handoverNote]
 */
export async function acceptHandover(userId, projectId, requestId, { assigneeMemberId, handoverNote } = {}) {
  const { project, role } = await resolveAccess(userId, projectId);

  if (role !== "OWNER") {
    throw new HandoverError(
      "Only the project owner can accept a handover request",
      403,
    );
  }

  if (!assigneeMemberId) {
    throw new HandoverError(
      "assigneeMemberId is required — accepting a handover needs a new owner",
      400,
    );
  }

  const request = await prisma.taskHandoverRequest.findFirst({
    where: { id: requestId, projectId },
    select: REQUEST_SELECT,
  });

  if (!request) throw new HandoverError("Handover request not found", 404);
  if (request.status !== "PENDING") {
    throw new HandoverError("This handover request has already been decided", 409);
  }

  if (assigneeMemberId === request.requesterMemberId) {
    throw new HandoverError(
      "The new owner must be a different member — decline the request instead",
      400,
    );
  }

  const newOwner = await prisma.projectMember.findFirst({
    where: { id: assigneeMemberId, projectId, status: "ACTIVE" },
    select: { id: true, userId: true, user: { select: { name: true } } },
  });
  if (!newOwner) {
    throw new HandoverError(
      "assigneeMemberId must be an active member of this project",
      400,
    );
  }

  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const decided = await tx.taskHandoverRequest.update({
      where: { id: requestId },
      data: {
        status:      "ACCEPTED",
        decidedById: userId,
        decidedAt:   now,
      },
      select: REQUEST_SELECT,
    });

    const task = await tx.task.update({
      where: { id: request.task.id },
      data: {
        assigneeMemberId: newOwner.id,
        ...(handoverNote !== undefined && { handoverNote: handoverNote ?? null }),
      },
      select: { id: true, title: true, assigneeMemberId: true },
    });

    return { request: decided, task };
  });

  // Tell the requester the task is no longer theirs.
  await createNotification({
    userId:     request.requesterId,
    type:       "TASK_HANDOVER_DECIDED",
    projectId,
    entityType: "taskHandoverRequest",
    entityId:   request.id,
    title:      `Handover accepted: ${request.task.title}`,
    message:    `The project owner handed "${request.task.title}" over to ${newOwner.user?.name ?? "another teammate"}.`,
    data: {
      taskId:    request.task.id,
      requestId: request.id,
      decision:  "ACCEPTED",
      reassignedToRequester: false,
    },
    dedupeKey: `handover-decided:${request.id}:accepted`,
  });

  // Tell the new owner the task is theirs.
  await createNotification({
    userId:     newOwner.userId,
    type:       "TASK_ASSIGNED",
    projectId,
    entityType: "task",
    entityId:   updated.task.id,
    title:      `Task assigned: ${updated.task.title}`,
    message:    `You were assigned "${updated.task.title}" on ${project.title}.`,
    data: {
      taskId:      updated.task.id,
      projectId,
      projectSlug: project.slug,
      fromHandover: true,
    },
    dedupeKey: `task-assigned:${updated.task.id}:${newOwner.userId}:handover`,
  });

  return updated.request;
}

// ─────────────────────────────────────────────────────────────────────────────
// cancelHandover
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The requester withdraws their own handover request.
 */
export async function cancelHandover(userId, projectId, requestId) {
  await resolveAccess(userId, projectId);

  const request = await prisma.taskHandoverRequest.findFirst({
    where: { id: requestId, projectId },
    select: REQUEST_SELECT,
  });

  if (!request) throw new HandoverError("Handover request not found", 404);

  if (request.requesterId !== userId) {
    throw new HandoverError("Only the requester can cancel a handover request", 403);
  }

  if (request.status !== "PENDING") {
    throw new HandoverError("This handover request has already been decided", 409);
  }

  const cancelled = await prisma.taskHandoverRequest.update({
    where: { id: requestId },
    data: {
      status:      "CANCELLED",
      decidedById: userId,
      decidedAt:   new Date(),
    },
    select: REQUEST_SELECT,
  });

  return cancelled;
}

// ─────────────────────────────────────────────────────────────────────────────
// acceptPendingRequestsForTask
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called when the project owner reassigns a task.
 *
 * This is the ONLY thing that changes the task owner — the request itself
 * never did. Any pending handover request for the task is now resolved as
 * ACCEPTED and the requester is told — with a message that distinguishes
 * whether the task went to them specifically or to someone else.
 *
 * @param {object} tx              — Prisma transaction client
 * @param {string} taskId
 * @param {string} projectId
 * @param {string} decidedById     — the owner/manager who reassigned the task
 * @param {string} newAssigneeUserId — the userId of the new assignee (may differ from requester)
 */
export async function acceptPendingRequestsForTask(tx, taskId, projectId, decidedById, newAssigneeUserId) {
  const pending = await tx.taskHandoverRequest.findMany({
    where: { taskId, status: "PENDING" },
    select: { id: true, requesterId: true, task: { select: { title: true } } },
  });

  if (pending.length === 0) return [];

  const now = new Date();
  await tx.taskHandoverRequest.updateMany({
    where: { id: { in: pending.map((p) => p.id) } },
    data: {
      status:      "ACCEPTED",
      decidedById,
      decidedAt:   now,
    },
  });

  for (const request of pending) {
    const reassignedToRequester = newAssigneeUserId === request.requesterId;
    const message = reassignedToRequester
      ? `The project owner reassigned "${request.task.title}" to you. Your handover request was accepted.`
      : `The project owner reassigned "${request.task.title}" to another team member. Your handover request was resolved.`;

    await createNotification({
      userId:     request.requesterId,
      type:       "TASK_HANDOVER_DECIDED",
      projectId,
      entityType: "taskHandoverRequest",
      entityId:   request.id,
      title:      `Handover resolved: ${request.task.title}`,
      message,
      data: {
        taskId,
        requestId:            request.id,
        decision:             "ACCEPTED",
        reassignedToRequester,
      },
      dedupeKey: `handover-decided:${request.id}:accepted`,
    });
  }

  return pending;
}

// ─────────────────────────────────────────────────────────────────────────────
// cancelPendingRequestsForMember
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cancel all PENDING handover requests made by a member who is leaving or
 * being released from a project.
 *
 * Must be called inside the same Prisma transaction as the membership status
 * update so the two changes are atomic.
 *
 * @param {object} tx         — Prisma transaction client
 * @param {string} memberId   — ProjectMember.id of the departing member
 * @param {string} projectId
 * @param {string} actorId    — userId of whoever triggered the removal (member themselves or owner/manager)
 */
export async function cancelPendingRequestsForMember(tx, memberId, projectId, actorId) {
  const pending = await tx.taskHandoverRequest.findMany({
    where: { requesterMemberId: memberId, projectId, status: "PENDING" },
    select: { id: true },
  });

  if (pending.length === 0) return;

  await tx.taskHandoverRequest.updateMany({
    where: { id: { in: pending.map((r) => r.id) } },
    data: {
      status:      "CANCELLED",
      decidedById: actorId,
      decidedAt:   new Date(),
    },
  });
}
