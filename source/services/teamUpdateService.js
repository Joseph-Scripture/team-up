import prisma from "../db/client.js";

const UPDATES_PER_PAGE = 20;
const MAX_PER_PAGE     = 50;

export class TeamUpdateError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name   = "TeamUpdateError";
    this.status = status;
  }
}

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
  if (!project) throw new TeamUpdateError("Project not found", 404);
  if (project.ownerId !== userId && project.memberships.length === 0) {
    throw new TeamUpdateError("Project not found", 404);
  }
}

export async function createTeamUpdate(userId, projectId, { content }) {
  await assertMember(userId, projectId);

  return prisma.teamUpdate.create({
    data: { projectId, authorId: userId, content: content.trim() },
    select: {
      id: true, content: true, createdAt: true, updatedAt: true,
      author: { select: { id: true, name: true, avatarUrl: true } },
    },
  });
}

export async function listTeamUpdates(userId, projectId, { page = 1, limit = UPDATES_PER_PAGE } = {}) {
  await assertMember(userId, projectId);

  const safePage  = Math.max(1, Number(page));
  const safeLimit = Math.min(MAX_PER_PAGE, Math.max(1, Number(limit)));
  const skip      = (safePage - 1) * safeLimit;

  const [updates, total] = await Promise.all([
    prisma.teamUpdate.findMany({
      where:   { projectId },
      orderBy: { createdAt: "desc" },
      skip,
      take: safeLimit,
      select: {
        id: true, content: true, createdAt: true, updatedAt: true,
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    }),
    prisma.teamUpdate.count({ where: { projectId } }),
  ]);

  return {
    updates,
    pagination: {
      total,
      page:       safePage,
      limit:      safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}
