import prisma from "../db/client.js";
import { createNotification } from "./notificationService.js";

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

  // Load project with all active members so we can notify everyone except the author
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true, title: true, slug: true, ownerId: true,
      memberships: {
        where: { status: "ACTIVE" },
        select: { userId: true },
      },
    },
  });

  const update = await prisma.teamUpdate.create({
    data: { projectId, authorId: userId, content: content.trim() },
    select: {
      id: true, content: true, createdAt: true, updatedAt: true,
      author: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  // Notify every active member except the author (fire-and-forget)
  const recipientIds = new Set();

  // Include the owner
  if (project.ownerId !== userId) {
    recipientIds.add(project.ownerId);
  }

  // Include all active members
  for (const { userId: memberId } of project.memberships) {
    if (memberId !== userId) {
      recipientIds.add(memberId);
    }
  }

  const authorName = update.author.name;

  await Promise.all(
    [...recipientIds].map((recipientId) =>
      createNotification({
        userId:     recipientId,
        type:       "TEAM_UPDATE",
        projectId,
        entityType: "teamUpdate",
        entityId:   update.id,
        title:      `New update on ${project.title}`,
        message:    `${authorName} posted a team update.`,
        data: {
          updateId:    update.id,
          projectSlug: project.slug,
        },
        dedupeKey: `team-update:${update.id}:${recipientId}`,
      }),
    ),
  );

  return update;
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
