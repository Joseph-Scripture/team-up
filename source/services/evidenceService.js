import prisma from "../db/client.js";
import { createNotification } from "./notificationService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Project deliverables (evidence)
//
// A deliverable is the proof that the team actually produced something: a
// repository, a live demo, a document, an image, a video.
//
// A project can only be completed when at least one deliverable exists.
// ─────────────────────────────────────────────────────────────────────────────

export class EvidenceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name   = "EvidenceError";
    this.status = status;
  }
}

const VALID_TYPES = ["REPOSITORY", "LIVE_DEMO", "DOCUMENT", "IMAGE", "VIDEO", "OTHER"];

/**
 * Load the project and check that the caller is part of the team.
 * Returns { project, role, memberId }.
 */
async function resolveAccess(userId, projectId, { includeMembers = false } = {}) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true, title: true, slug: true, ownerId: true,
      memberships: {
        where: includeMembers ? { status: "ACTIVE" } : { userId, status: "ACTIVE" },
        select: { id: true, userId: true, accessRole: true },
      },
    },
  });

  if (!project) throw new EvidenceError("Project not found", 404);

  const isOwner = project.ownerId === userId;
  const membership = project.memberships.find((m) => m.userId === userId) ?? project.memberships[0];
  if (!isOwner && !membership) {
    throw new EvidenceError("Project not found", 404);
  }

  const role = isOwner ? "OWNER"
    : membership.accessRole === "MANAGER" ? "MANAGER"
    : "MEMBER";

  return { project, role, memberId: membership?.id ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// listEvidence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List the deliverables of a project. Any active member can call this.
 */
export async function listEvidence(userId, projectId) {
  await resolveAccess(userId, projectId);

  const evidence = await prisma.projectEvidence.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, title: true, description: true, url: true, type: true,
      createdAt: true, updatedAt: true,
      createdBy: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  return { evidence };
}

// ─────────────────────────────────────────────────────────────────────────────
// addEvidence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add a deliverable to a project.
 *
 * The project owner and its managers write the project record, so only they
 * can add deliverables.
 */
export async function addEvidence(userId, projectId, { title, description, url, type }) {
  const { role, project } = await resolveAccess(userId, projectId, { includeMembers: true });

  if (role !== "OWNER" && role !== "MANAGER") {
    throw new EvidenceError(
      "Only the project owner or a manager can add a deliverable",
      403,
    );
  }

  const evidenceType = (type ?? "OTHER").toUpperCase();
  if (!VALID_TYPES.includes(evidenceType)) {
    throw new EvidenceError(`type must be one of: ${VALID_TYPES.join(", ")}`);
  }

  const created = await prisma.projectEvidence.create({
    data: {
      projectId,
      createdById: userId,
      title: title.trim(),
      description: description ?? null,
      url: url.trim(),
      type: evidenceType,
    },
    select: {
      id: true, title: true, description: true, url: true, type: true,
      createdAt: true, updatedAt: true,
      createdBy: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  // Notify every other active team member so they know a deliverable was added.
  const recipients = project.memberships
    .map((m) => m.userId)
    .filter((id) => id !== userId);

  // Also notify the project owner if the caller is a manager (not the owner).
  if (project.ownerId !== userId) {
    recipients.push(project.ownerId);
  }

  // Fire the notifications in parallel: each one is a user lookup plus an
  // insert, and a slow database should not turn one request into N round-trips
  // of latency. createNotification never throws.
  await Promise.all([...new Set(recipients)].map((recipientId) =>
    createNotification({
      userId:     recipientId,
      type:       "EVIDENCE_ADDED",
      projectId,
      entityType: "evidence",
      entityId:   created.id,
      title:      `New deliverable added: ${created.title}`,
      message:    `A new deliverable was added to ${project.title}: "${created.title}".`,
      data:       { evidenceId: created.id, projectId, evidenceType: created.type },
      dedupeKey:  `evidence-added:${created.id}:${recipientId}`,
    }),
  ));

  return created;
}

// ─────────────────────────────────────────────────────────────────────────────
// updateEvidence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update a deliverable's metadata (patch semantics — only sent fields are written).
 * Owner / manager only.
 */
export async function updateEvidence(userId, projectId, evidenceId, { title, description, url, type }) {
  const { role } = await resolveAccess(userId, projectId);

  if (role !== "OWNER" && role !== "MANAGER") {
    throw new EvidenceError(
      "Only the project owner or a manager can update a deliverable",
      403,
    );
  }

  const existing = await prisma.projectEvidence.findFirst({
    where: { id: evidenceId, projectId },
    select: { id: true },
  });
  if (!existing) throw new EvidenceError("Deliverable not found", 404);

  // Build the update payload with only the fields that were supplied.
  const data = {};
  if (title       !== undefined) data.title       = title.trim();
  if (description !== undefined) data.description = description ?? null;
  if (url         !== undefined) data.url         = url.trim();
  if (type        !== undefined) {
    const evidenceType = type.toUpperCase();
    if (!VALID_TYPES.includes(evidenceType)) {
      throw new EvidenceError(`type must be one of: ${VALID_TYPES.join(", ")}`);
    }
    data.type = evidenceType;
  }

  if (Object.keys(data).length === 0) {
    throw new EvidenceError("No fields provided to update", 400);
  }

  const updated = await prisma.projectEvidence.update({
    where: { id: evidenceId },
    data,
    select: {
      id: true, title: true, description: true, url: true, type: true,
      createdAt: true, updatedAt: true,
      createdBy: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteEvidence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remove a deliverable. Owner / manager only.
 */
export async function deleteEvidence(userId, projectId, evidenceId) {
  const { role } = await resolveAccess(userId, projectId);

  if (role !== "OWNER" && role !== "MANAGER") {
    throw new EvidenceError(
      "Only the project owner or a manager can remove a deliverable",
      403,
    );
  }

  const existing = await prisma.projectEvidence.findFirst({
    where: { id: evidenceId, projectId },
    select: { id: true },
  });
  if (!existing) throw new EvidenceError("Deliverable not found", 404);

  await prisma.projectEvidence.delete({ where: { id: evidenceId } });
  return { id: evidenceId };
}
