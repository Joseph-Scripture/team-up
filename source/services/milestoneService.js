import prisma from "../db/client.js";

// ─────────────────────────────────────────────────────────────────────────────
// Custom error
// ─────────────────────────────────────────────────────────────────────────────

export class MilestoneError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name   = "MilestoneError";
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assert the caller is an active project owner or manager.
 * Returns the project row on success, throws 403/404 otherwise.
 */
async function assertOwnerOrManager(userId, projectId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true, ownerId: true,
      memberships: {
        where: { userId, status: "ACTIVE" },
        select: { accessRole: true },
      },
    },
  });
  if (!project) throw new MilestoneError("Project not found", 404);

  const isOwner   = project.ownerId === userId;
  const isManager = project.memberships[0]?.accessRole === "MANAGER";
  if (!isOwner && !isManager) {
    throw new MilestoneError("Only the project owner or a manager can manage milestones", 403);
  }
  return project;
}

/**
 * Assert the caller is an active member of the project (any role).
 */
async function assertMember(userId, projectId) {
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
  if (!project) throw new MilestoneError("Project not found", 404);

  const isMember = project.ownerId === userId || project.memberships.length > 0;
  if (!isMember) throw new MilestoneError("Project not found", 404);
  return project;
}

// ─────────────────────────────────────────────────────────────────────────────
// createMilestone
// ─────────────────────────────────────────────────────────────────────────────

export async function createMilestone(userId, projectId, { title, description, dueDate, sortOrder }) {
  await assertOwnerOrManager(userId, projectId);

  return prisma.milestone.create({
    data: {
      projectId,
      title:       title.trim(),
      description: description ?? null,
      dueDate:     dueDate     ?? null,
      sortOrder:   sortOrder   ?? 0,
    },
    select: {
      id: true, title: true, description: true,
      dueDate: true, status: true, sortOrder: true,
      completedAt: true, createdAt: true,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// listMilestones
// ─────────────────────────────────────────────────────────────────────────────

export async function listMilestones(userId, projectId) {
  await assertMember(userId, projectId);

  return prisma.milestone.findMany({
    where:   { projectId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, title: true, description: true,
      dueDate: true, status: true, sortOrder: true,
      completedAt: true, createdAt: true,
      _count: { select: { tasks: true } },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// updateMilestone
// ─────────────────────────────────────────────────────────────────────────────

export async function updateMilestone(userId, projectId, milestoneId, fields) {
  await assertOwnerOrManager(userId, projectId);

  const milestone = await prisma.milestone.findFirst({
    where: { id: milestoneId, projectId },
  });
  if (!milestone) throw new MilestoneError("Milestone not found", 404);

  const { title, description, dueDate, status, sortOrder } = fields;

  const data = {};
  if (title       !== undefined) data.title       = title.trim();
  if (description !== undefined) data.description = description;
  if (dueDate     !== undefined) data.dueDate     = dueDate;
  if (sortOrder   !== undefined) data.sortOrder   = sortOrder;
  if (status      !== undefined) {
    data.status = status;
    if (status === "COMPLETED" && !milestone.completedAt) {
      data.completedAt = new Date();
    } else if (status !== "COMPLETED") {
      data.completedAt = null;
    }
  }

  return prisma.milestone.update({
    where:  { id: milestoneId },
    data,
    select: {
      id: true, title: true, description: true,
      dueDate: true, status: true, sortOrder: true,
      completedAt: true, updatedAt: true,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteMilestone
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deletes a milestone. Tasks that belonged to it are unlinked (milestoneId set
 * to null) — they are NOT deleted. Schema uses onDelete: NoAction on the
 * task→milestone FK so we must unlink first.
 */
export async function deleteMilestone(userId, projectId, milestoneId) {
  await assertOwnerOrManager(userId, projectId);

  const milestone = await prisma.milestone.findFirst({
    where: { id: milestoneId, projectId },
  });
  if (!milestone) throw new MilestoneError("Milestone not found", 404);

  // Unlink tasks first, then delete the milestone — both in a transaction.
  await prisma.$transaction([
    prisma.task.updateMany({
      where: { milestoneId, projectId },
      data:  { milestoneId: null },
    }),
    prisma.milestone.delete({ where: { id: milestoneId } }),
  ]);

  return { message: "Milestone deleted. Linked tasks have been unlinked." };
}
