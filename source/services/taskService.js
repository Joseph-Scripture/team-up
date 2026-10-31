import prisma from "../db/client.js";
import { createNotification } from "./notificationService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TASKS_PER_PAGE = 50;

const VALID_STATUSES  = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "COMPLETED", "CANCELLED"];
const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

// ─────────────────────────────────────────────────────────────────────────────
// Custom error
// ─────────────────────────────────────────────────────────────────────────────

export class TaskError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name   = "TaskError";
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification helpers (fire-and-forget)
// ─────────────────────────────────────────────────────────────────────────────

async function notifyTaskAssigned({ task, assigneeUserId, projectId, projectTitle, assignerName }) {
  await createNotification({
    userId:     assigneeUserId,
    type:       "TASK_ASSIGNED",
    projectId,
    entityType: "task",
    entityId:   task.id,
    title:      `You were assigned a task: ${task.title}`,
    message:    `${assignerName} assigned you to "${task.title}" on ${projectTitle}.`,
    data:       { taskId: task.id, projectId },
    dedupeKey:  `task-assigned:${task.id}:${assigneeUserId}`,
  });
}

async function notifyTaskCommented({ comment, taskTitle, taskId, taskOwnerId, commentAuthorId, commentAuthorName, projectId }) {
  // Notify the task owner when someone else comments
  if (taskOwnerId && taskOwnerId !== commentAuthorId) {
    await createNotification({
      userId:     taskOwnerId,
      type:       "TASK_COMMENTED",
      projectId,
      entityType: "task",
      entityId:   taskId,
      title:      `New comment on "${taskTitle}"`,
      message:    `${commentAuthorName} commented on your task.`,
      data:       { taskId, commentId: comment.id, projectId },
      dedupeKey:  `task-comment:${comment.id}:${taskOwnerId}`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared select shapes
// ─────────────────────────────────────────────────────────────────────────────

const TASK_SELECT = {
  id: true, title: true, description: true,
  status: true, priority: true, sortOrder: true,
  estimatedHours: true, blockerNote: true,
  dueDate: true, startedAt: true, completedAt: true,
  createdAt: true, updatedAt: true,
  milestone: { select: { id: true, title: true } },
  assignee: {
    select: {
      id: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
      role: { select: { id: true, title: true } },
    },
  },
  createdBy: { select: { id: true, name: true, avatarUrl: true } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Permission helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the caller's access level on a project.
 * Returns { role: "OWNER"|"MANAGER"|"MEMBER", memberId: string|null }
 * Throws 404 if project not found, 403 if not a member.
 */
async function resolveAccess(userId, projectId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true, title: true, ownerId: true,
      memberships: {
        where: { userId, status: "ACTIVE" },
        select: { id: true, accessRole: true },
      },
    },
  });
  if (!project) throw new TaskError("Project not found", 404);

  if (project.ownerId === userId) {
    return { role: "OWNER", memberId: project.memberships[0]?.id ?? null, project };
  }
  const membership = project.memberships[0];
  if (!membership) throw new TaskError("Project not found", 404);

  const role = membership.accessRole === "MANAGER" ? "MANAGER" : "MEMBER";
  return { role, memberId: membership.id, project };
}

// ─────────────────────────────────────────────────────────────────────────────
// createTask
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Only Owner / Manager can create tasks (screen 1 shows "choose one accepted member").
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {object} body
 */
export async function createTask(userId, projectId, {
  title,
  description,
  assigneeMemberId,
  milestoneId,
  dueDate,
  priority,
  estimatedHours,
  sortOrder,
  status,
}) {
  const { role, project } = await resolveAccess(userId, projectId);
  if (role === "MEMBER") {
    throw new TaskError("Only the project owner or a manager can create tasks", 403);
  }

  // Validate assignee belongs to this project and is active
  if (assigneeMemberId) {
    const member = await prisma.projectMember.findFirst({
      where: { id: assigneeMemberId, projectId, status: "ACTIVE" },
      select: { id: true, userId: true },
    });
    if (!member) throw new TaskError("Assignee is not an active member of this project", 400);
  }

  // Validate milestone belongs to this project
  if (milestoneId) {
    const ms = await prisma.milestone.findFirst({
      where: { id: milestoneId, projectId },
    });
    if (!ms) throw new TaskError("Milestone not found on this project", 404);
  }

  const task = await prisma.task.create({
    data: {
      projectId,
      createdById:     userId,
      title:           title.trim(),
      description:     description     ?? null,
      assigneeMemberId: assigneeMemberId ?? null,
      milestoneId:     milestoneId     ?? null,
      dueDate:         dueDate         ?? null,
      priority:        priority        ?? "MEDIUM",
      estimatedHours:  estimatedHours  ?? null,
      sortOrder:       sortOrder       ?? 0,
      status:          status          ?? "TODO",
    },
    select: TASK_SELECT,
  });

  // Notify assignee (fire-and-forget)
  if (assigneeMemberId) {
    const member = await prisma.projectMember.findFirst({
      where: { id: assigneeMemberId, projectId },
      select: { userId: true },
    });
    const creator = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    if (member) {
      await notifyTaskAssigned({
        task,
        assigneeUserId: member.userId,
        projectId,
        projectTitle:   project.title,
        assignerName:   creator?.name ?? "A team member",
      });
    }
  }

  return task;
}

// ─────────────────────────────────────────────────────────────────────────────
// listTasks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List tasks for a project with optional filters.
 * Returns summary stats (total, done, notDone, overdue) for the progress bar.
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {object} filters
 * @param {string}  [filters.status]
 * @param {string}  [filters.milestoneId]
 * @param {string}  [filters.assigneeMemberId]
 * @param {boolean} [filters.mine] — if true, only return tasks assigned to caller
 * @param {number}  [filters.page=1]
 * @param {number}  [filters.limit=50]
 */
export async function listTasks(userId, projectId, {
  status,
  milestoneId,
  assigneeMemberId,
  mine,
  page  = 1,
  limit = TASKS_PER_PAGE,
} = {}) {
  const { memberId } = await resolveAccess(userId, projectId);

  const safePage  = Math.max(1, Number(page));
  const safeLimit = Math.min(100, Math.max(1, Number(limit)));
  const skip      = (safePage - 1) * safeLimit;
  const now       = new Date();

  // "My tasks" filter — find the caller's memberId for the assignee filter
  const effectiveAssigneeMemberId = mine ? memberId : (assigneeMemberId ?? undefined);

  const where = {
    projectId,
    ...(status               && VALID_STATUSES.includes(status.toUpperCase())
      && { status: status.toUpperCase() }),
    ...(milestoneId          && { milestoneId }),
    ...(effectiveAssigneeMemberId && { assigneeMemberId: effectiveAssigneeMemberId }),
  };

  // Run page query + summary stats in parallel
  const [tasks, total, doneCount, overdueCount] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }, { createdAt: "asc" }],
      skip,
      take: safeLimit,
      select: TASK_SELECT,
    }),
    prisma.task.count({ where }),
    prisma.task.count({ where: { projectId, status: "COMPLETED" } }),
    prisma.task.count({
      where: {
        projectId,
        dueDate: { lt: now },
        status:  { notIn: ["COMPLETED", "CANCELLED"] },
      },
    }),
  ]);

  const totalCount = await prisma.task.count({ where: { projectId } });

  return {
    summary: {
      total:    totalCount,
      done:     doneCount,
      notDone:  totalCount - doneCount,
      overdue:  overdueCount,
    },
    tasks,
    pagination: {
      total,
      page:       safePage,
      limit:      safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getTask
// ─────────────────────────────────────────────────────────────────────────────

export async function getTask(userId, projectId, taskId) {
  await resolveAccess(userId, projectId);

  const task = await prisma.task.findFirst({
    where: { id: taskId, projectId },
    select: {
      ...TASK_SELECT,
      contributions: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true, title: true, description: true,
          status: true, submittedAt: true,
          evidence: {
            select: { id: true, url: true, type: true, title: true },
          },
        },
      },
    },
  });

  if (!task) throw new TaskError("Task not found", 404);
  return task;
}

// ─────────────────────────────────────────────────────────────────────────────
// updateTask
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update a task. Permission rules:
 *   Owner / Manager — can update all fields
 *   Assignee (MEMBER) — can only update: status, blockerNote, contribution block
 *   Anyone else — 403
 *
 * When status is set to COMPLETED, an optional contribution block may be included.
 */
export async function updateTask(userId, projectId, taskId, fields) {
  const { role, memberId, project } = await resolveAccess(userId, projectId);

  const task = await prisma.task.findFirst({
    where: { id: taskId, projectId },
    select: {
      id: true, title: true, status: true,
      assigneeMemberId: true, blockerNote: true,
      startedAt: true, completedAt: true,
      assignee: { select: { userId: true } },
    },
  });
  if (!task) throw new TaskError("Task not found", 404);

  const isPrivileged = role === "OWNER" || role === "MANAGER";
  const isAssignee   = task.assigneeMemberId && task.assigneeMemberId === memberId;

  if (!isPrivileged && !isAssignee) {
    throw new TaskError("You do not have permission to update this task", 403);
  }

  const {
    title, description, priority, dueDate, estimatedHours,
    milestoneId, assigneeMemberId, sortOrder,
    status, blockerNote,
    contribution, // { title, completionNote, artifactUrl, fileUrl, fileType }
  } = fields;

  // Members can only touch status + blockerNote + contribution
  if (!isPrivileged) {
    const forbiddenFields = [
      title, description, priority, dueDate, estimatedHours,
      milestoneId, assigneeMemberId, sortOrder,
    ];
    if (forbiddenFields.some((f) => f !== undefined)) {
      throw new TaskError("Members can only update task status, blocker note, and contribution", 403);
    }
  }

  // ── Validate assignee if being changed ────────────────────────────────────
  if (assigneeMemberId !== undefined && assigneeMemberId !== null) {
    const member = await prisma.projectMember.findFirst({
      where: { id: assigneeMemberId, projectId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!member) throw new TaskError("Assignee is not an active member of this project", 400);
  }

  // ── Validate milestone if being changed ───────────────────────────────────
  if (milestoneId !== undefined && milestoneId !== null) {
    const ms = await prisma.milestone.findFirst({ where: { id: milestoneId, projectId } });
    if (!ms) throw new TaskError("Milestone not found on this project", 404);
  }

  // ── Status transition rules ───────────────────────────────────────────────
  const now        = new Date();
  const newStatus  = status ? status.toUpperCase() : null;

  if (newStatus && !VALID_STATUSES.includes(newStatus)) {
    throw new TaskError(`Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`, 400);
  }

  if (newStatus === "BLOCKED" && !blockerNote && !task.blockerNote) {
    throw new TaskError("A blocker note is required when setting status to BLOCKED", 400);
  }

  // ── Build update data ─────────────────────────────────────────────────────
  const data = {};
  if (title            !== undefined) data.title            = title.trim();
  if (description      !== undefined) data.description      = description;
  if (priority         !== undefined) data.priority         = priority.toUpperCase();
  if (dueDate          !== undefined) data.dueDate          = dueDate;
  if (estimatedHours   !== undefined) data.estimatedHours   = estimatedHours;
  if (milestoneId      !== undefined) data.milestoneId      = milestoneId;
  if (assigneeMemberId !== undefined) data.assigneeMemberId = assigneeMemberId;
  if (sortOrder        !== undefined) data.sortOrder        = sortOrder;

  if (blockerNote !== undefined) {
    data.blockerNote = blockerNote;
  }

  if (newStatus) {
    data.status = newStatus;

    // Clear blocker note when leaving BLOCKED
    if (task.status === "BLOCKED" && newStatus !== "BLOCKED") {
      data.blockerNote = null;
    }
    // Set startedAt on first move to IN_PROGRESS
    if (newStatus === "IN_PROGRESS" && !task.startedAt) {
      data.startedAt = now;
    }
    // Set / clear completedAt
    if (newStatus === "COMPLETED" && !task.completedAt) {
      data.completedAt = now;
    }
    if (newStatus !== "COMPLETED" && task.completedAt) {
      data.completedAt = null;
    }
  }

  // ── Contribution block (only when marking COMPLETED) ─────────────────────
  let createdContribution = null;

  if (contribution && (newStatus === "COMPLETED" || task.status === "COMPLETED")) {
    const { title: cTitle, completionNote, artifactUrl, fileUrl, fileType } = contribution;

    // Resolve contributor's memberId
    const contributorMemberId = isAssignee
      ? memberId
      : task.assigneeMemberId ?? memberId; // owner completing on behalf

    if (contributorMemberId) {
      const evidenceRows = [];
      if (artifactUrl) {
        evidenceRows.push({ url: artifactUrl, type: "LIVE_DEMO",  title: "Artifact link" });
      }
      if (fileUrl) {
        evidenceRows.push({
          url:   fileUrl,
          type:  fileType ?? "DOCUMENT",
          title: "Attached file",
        });
      }

      createdContribution = await prisma.contribution.create({
        data: {
          projectId,
          memberId:    contributorMemberId,
          taskId,
          title:       cTitle?.trim() || task.title,
          description: completionNote ?? null,
          status:      "PENDING_REVIEW",
          evidence:    evidenceRows.length > 0
            ? { create: evidenceRows }
            : undefined,
        },
        select: {
          id: true, title: true, description: true, status: true,
          evidence: { select: { id: true, url: true, type: true, title: true } },
        },
      });
    }
  }

  // ── Perform the update ────────────────────────────────────────────────────
  const updatedTask = await prisma.task.update({
    where:  { id: taskId },
    data,
    select: TASK_SELECT,
  });

  // ── Notify new assignee if assignment changed ─────────────────────────────
  if (
    isPrivileged &&
    assigneeMemberId !== undefined &&
    assigneeMemberId !== null &&
    assigneeMemberId !== task.assigneeMemberId
  ) {
    const newMember = await prisma.projectMember.findFirst({
      where: { id: assigneeMemberId, projectId },
      select: { userId: true },
    });
    const assigner = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    if (newMember) {
      await notifyTaskAssigned({
        task: updatedTask,
        assigneeUserId: newMember.userId,
        projectId,
        projectTitle:   project.title,
        assignerName:   assigner?.name ?? "A team member",
      });
    }
  }

  return { task: updatedTask, contribution: createdContribution };
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteTask
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteTask(userId, projectId, taskId) {
  const { role } = await resolveAccess(userId, projectId);
  if (role === "MEMBER") {
    throw new TaskError("Only the project owner or a manager can delete tasks", 403);
  }

  const task = await prisma.task.findFirst({ where: { id: taskId, projectId } });
  if (!task) throw new TaskError("Task not found", 404);

  await prisma.task.delete({ where: { id: taskId } });
  return { message: "Task deleted." };
}

// ─────────────────────────────────────────────────────────────────────────────
// createComment
// ─────────────────────────────────────────────────────────────────────────────

export async function createComment(userId, projectId, taskId, { content }) {
  await resolveAccess(userId, projectId);

  const task = await prisma.task.findFirst({
    where: { id: taskId, projectId },
    select: {
      id: true, title: true,
      assignee: { select: { userId: true } },
    },
  });
  if (!task) throw new TaskError("Task not found", 404);

  const comment = await prisma.taskComment.create({
    data: { taskId, authorId: userId, content: content.trim() },
    select: {
      id: true, content: true, editedAt: true, createdAt: true,
      author: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  // Notify the task's assignee of the new comment
  const assigneeUserId = task.assignee?.userId;
  if (assigneeUserId) {
    const author = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    await notifyTaskCommented({
      comment,
      taskTitle:         task.title,
      taskId,
      taskOwnerId:       assigneeUserId,
      commentAuthorId:   userId,
      commentAuthorName: author?.name ?? "A team member",
      projectId,
    });
  }

  return comment;
}

// ─────────────────────────────────────────────────────────────────────────────
// listComments
// ─────────────────────────────────────────────────────────────────────────────

export async function listComments(userId, projectId, taskId) {
  await resolveAccess(userId, projectId);

  const task = await prisma.task.findFirst({ where: { id: taskId, projectId } });
  if (!task) throw new TaskError("Task not found", 404);

  return prisma.taskComment.findMany({
    where:   { taskId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, content: true, editedAt: true, createdAt: true,
      author: { select: { id: true, name: true, avatarUrl: true } },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// updateComment
// ─────────────────────────────────────────────────────────────────────────────

export async function updateComment(userId, projectId, taskId, commentId, { content }) {
  await resolveAccess(userId, projectId);

  const comment = await prisma.taskComment.findFirst({
    where: { id: commentId, taskId, deletedAt: null },
    select: { id: true, authorId: true },
  });
  if (!comment) throw new TaskError("Comment not found", 404);
  if (comment.authorId !== userId) {
    throw new TaskError("You can only edit your own comments", 403);
  }

  return prisma.taskComment.update({
    where:  { id: commentId },
    data:   { content: content.trim(), editedAt: new Date() },
    select: {
      id: true, content: true, editedAt: true, createdAt: true,
      author: { select: { id: true, name: true, avatarUrl: true } },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteComment  (soft delete)
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteComment(userId, projectId, taskId, commentId) {
  const { role } = await resolveAccess(userId, projectId);

  const comment = await prisma.taskComment.findFirst({
    where: { id: commentId, taskId, deletedAt: null },
    select: { id: true, authorId: true },
  });
  if (!comment) throw new TaskError("Comment not found", 404);

  const isAuthor     = comment.authorId === userId;
  const isPrivileged = role === "OWNER" || role === "MANAGER";

  if (!isAuthor && !isPrivileged) {
    throw new TaskError("You do not have permission to delete this comment", 403);
  }

  await prisma.taskComment.update({
    where: { id: commentId },
    data:  { deletedAt: new Date() },
  });

  return { message: "Comment deleted." };
}
