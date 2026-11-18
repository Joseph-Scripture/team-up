import prisma from "../db/client.js";
import {
  cacheGet, cacheSet, withCache, cacheDel, cacheDelPattern,
  CacheKey, TTL,
} from "../lib/cache.js";
import { createNotification } from "./notificationService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive a URL-safe slug from a title, then append a short random suffix so
 * two projects with the same name never collide.
 */
function makeSlug(title) {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  const suffix = Math.random().toString(36).slice(2, 8); // 6 random chars
  return `${base}-${suffix}`;
}

/**
 * Resolve skill IDs from the body array.
 * Each item is expected to be { skillId, minLevel? } or { skillId, required? }.
 */
function buildSkillConnect(skills = []) {
  return skills.map(({ skillId, required = true, minLevel }) => ({
    skillId,
    required,
    ...(minLevel ? { minLevel } : {}),
  }));
}

/**
 * Standard project shape returned to the client.
 * Includes owner, skills, roles (with their skills), and milestones.
 */
const PROJECT_INCLUDE = {
  owner: { select: { id: true, name: true, avatarUrl: true } },
  skills: {
    include: { skill: { select: { id: true, name: true, slug: true, category: true } } },
  },
  roles: {
    orderBy: { createdAt: "asc" },
    include: {
      skills: {
        include: { skill: { select: { id: true, name: true, slug: true, category: true } } },
      },
    },
  },
  milestones: { orderBy: { sortOrder: "asc" } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Custom error class — controllers catch this and return the right HTTP status
// ─────────────────────────────────────────────────────────────────────────────

export class ProjectError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ProjectError";
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// createDraft
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a new project in DRAFT status.
 * Only `title` is mandatory; all other fields are optional so the wizard can
 * save an incomplete draft at any step.
 *
 * Nested writes handled in a single transaction:
 *   ProjectSkill[]  — project-level required skills
 *   ProjectRole[]   — with their RoleSkill[] nested inside
 *   Milestone[]
 *
 * @param {string} ownerId
 * @param {object} data  — validated body from saveDraftRules
 * @returns {object} the created project with relations
 */
export async function createDraft(ownerId, data) {
  const {
    title,
    problem,
    description = "",
    projectType,
    outcome,
    teamSize,
    durationWeeks = 1,
    weeklyHours,
    startDate,
    targetEndDate,
    availabilityExpectation,
    availabilityResponseExpectation,
    skills = [],
    roles = [],
    milestones = [],
  } = data;

  // Validate date ordering when both are provided
  if (startDate && targetEndDate && new Date(targetEndDate) < new Date(startDate)) {
    throw new ProjectError("Planned end date must be on or after the start date");
  }

  const slug = makeSlug(title);

  const project = await prisma.project.create({
    data: {
      title,
      slug,
      description,
      problem,
      outcome,
      projectType,
      teamSize,
      durationWeeks,
      weeklyHours: weeklyHours ?? 1,
      startDate: startDate ? new Date(startDate) : null,
      targetEndDate: targetEndDate ? new Date(targetEndDate) : null,
      availabilityExpectation,
      availabilityResponseExpectation,
      status: "DRAFT",
      ownerId,

      // Project-level skills
      skills: {
        create: buildSkillConnect(skills),
      },

      // Roles with their nested skills
      roles: {
        create: roles.map(({ title: roleTitle, description: roleDesc, hoursPerWeek, skills: roleSkills = [] }) => ({
          title: roleTitle,
          description: roleDesc ?? "",
          hoursPerWeek,
          skills: {
            create: roleSkills.map(({ skillId, minLevel, required = true }) => ({
              skillId,
              required,
              ...(minLevel ? { minLevel } : {}),
            })),
          },
        })),
      },

      // Milestones — sortOrder follows array position
      milestones: {
        create: milestones.map(({ title: msTitle, description: msDesc, dueDate }, idx) => ({
          title: msTitle,
          description: msDesc,
          dueDate: dueDate ? new Date(dueDate) : null,
          sortOrder: idx,
        })),
      },
    },
    include: PROJECT_INCLUDE,
  });

  // Create the owner's membership row so they show up as a member immediately
  await prisma.projectMember.create({
    data: {
      projectId: project.id,
      userId: ownerId,
      accessRole: "OWNER",
      status: "ACTIVE",
    },
  });

  // Invalidate owner's project list — a new project appeared
  await cacheDel(CacheKey.projectsMine(ownerId));

  return project;
}

// ─────────────────────────────────────────────────────────────────────────────
// updateDraft
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replaces the mutable fields of an existing DRAFT project.
 * Skills, roles, and milestones are fully replaced (delete + re-create) so the
 * client always sends the complete desired state — simple and correct for a
 * multi-step wizard.
 *
 * Only the project owner can update a draft. Only DRAFT projects can be updated
 * through this function (published projects go through dedicated transitions).
 *
 * @param {string} projectId
 * @param {string} ownerId
 * @param {object} data  — validated body from saveDraftRules
 * @returns {object} the updated project with relations
 */
export async function updateDraft(projectId, ownerId, data) {
  const existing = await prisma.project.findUnique({ where: { id: projectId } });

  if (!existing || existing.deletedAt) {
    throw new ProjectError("Project not found", 404);
  }
  if (existing.ownerId !== ownerId) {
    throw new ProjectError("Only the project owner can edit this project", 403);
  }
  if (existing.status !== "DRAFT") {
    throw new ProjectError("Only draft projects can be updated through this endpoint", 409);
  }

  const {
    title,
    problem,
    description,
    projectType,
    outcome,
    teamSize,
    durationWeeks,
    weeklyHours,
    startDate,
    targetEndDate,
    availabilityExpectation,
    availabilityResponseExpectation,
    skills,
    roles,
    milestones,
  } = data;

  if (startDate && targetEndDate && new Date(targetEndDate) < new Date(startDate)) {
    throw new ProjectError("Planned end date must be on or after the start date");
  }

  // Run replacements inside a transaction so we never end up with a project
  // that has some old roles and some new milestones.
  const project = await prisma.$transaction(async (tx) => {
    // 1. Replace project-level skills if provided
    if (skills !== undefined) {
      await tx.projectSkill.deleteMany({ where: { projectId } });
      if (skills.length > 0) {
        await tx.projectSkill.createMany({
          data: buildSkillConnect(skills).map((s) => ({ ...s, projectId })),
        });
      }
    }

    // 2. Replace roles (and their skills) if provided
    if (roles !== undefined) {
      // Cascade delete removes RoleSkill rows automatically
      await tx.projectRole.deleteMany({ where: { projectId } });
      for (const [idx, role] of roles.entries()) {
        await tx.projectRole.create({
          data: {
            projectId,
            title: role.title,
            description: role.description ?? "",
            hoursPerWeek: role.hoursPerWeek,
            // AI-matching fields (all optional)
            ...(role.topics      !== undefined && { topics:      role.topics      }),
            ...(role.goal        !== undefined && { goal:        role.goal        }),
            ...(role.workMode    !== undefined && { workMode:    role.workMode    }),
            ...(role.targetLevel !== undefined && { targetLevel: role.targetLevel }),
            skills: {
              create: (role.skills ?? []).map(({ skillId, minLevel, required = true }) => ({
                skillId,
                required,
                ...(minLevel ? { minLevel } : {}),
              })),
            },
          },
        });
      }
    }

    // 3. Replace milestones if provided
    if (milestones !== undefined) {
      // The draft editor sends a replacement list without stable milestone IDs.
      // Once tasks reference milestones, deleting and recreating that list would
      // either violate the foreign key or silently detach work from its plan.
      const linkedTaskCount = await tx.task.count({
        where: { projectId, milestoneId: { not: null } },
      });
      if (linkedTaskCount > 0) {
        throw new ProjectError(
          "Milestones with linked tasks must be managed individually through the milestone endpoints",
          409,
        );
      }
      await tx.milestone.deleteMany({ where: { projectId } });
      if (milestones.length > 0) {
        await tx.milestone.createMany({
          data: milestones.map(({ title: msTitle, description: msDesc, dueDate }, idx) => ({
            projectId,
            title: msTitle,
            description: msDesc,
            dueDate: dueDate ? new Date(dueDate) : null,
            sortOrder: idx,
          })),
        });
      }
    }

    // 4. Update the project scalar fields — only include fields present in body
    const scalarUpdate = {
      ...(title !== undefined && { title }),
      ...(problem !== undefined && { problem }),
      ...(description !== undefined && { description }),
      ...(projectType !== undefined && { projectType }),
      ...(outcome !== undefined && { outcome }),
      ...(teamSize !== undefined && { teamSize }),
      ...(durationWeeks !== undefined && { durationWeeks }),
      ...(weeklyHours !== undefined && { weeklyHours }),
      ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
      ...(targetEndDate !== undefined && { targetEndDate: targetEndDate ? new Date(targetEndDate) : null }),
      ...(availabilityExpectation !== undefined && { availabilityExpectation }),
      ...(availabilityResponseExpectation !== undefined && { availabilityResponseExpectation }),
    };

    return tx.project.update({
      where: { id: projectId },
      data: scalarUpdate,
      include: PROJECT_INCLUDE,
    });
  });

  // Invalidate project detail and owner's list
  await cacheDel(
    CacheKey.project(projectId),
    CacheKey.projectsMine(ownerId),
  );

  return project;
}

// ─────────────────────────────────────────────────────────────────────────────
// publishProject
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that all required fields are present and transitions the project
 * from DRAFT → OPEN, setting publishedAt to now.
 *
 * The caller (controller) should have already run publishRules validation, so
 * this is a final sanity-check before the DB write.
 *
 * @param {string} projectId
 * @param {string} ownerId
 * @returns {object} the published project with relations
 */
export async function publishProject(projectId, ownerId) {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      skills: true,
      roles: { include: { skills: true } },
      milestones: true,
    },
  });

  if (!existing || existing.deletedAt) {
    throw new ProjectError("Project not found", 404);
  }
  if (existing.ownerId !== ownerId) {
    throw new ProjectError("Only the project owner can publish this project", 403);
  }
  if (existing.status !== "DRAFT") {
    throw new ProjectError("Only draft projects can be published", 409);
  }

  // Final completeness checks (belt-and-suspenders on top of publishRules)
  const missing = [];
  if (!existing.problem) missing.push("problem");
  if (!existing.description) missing.push("description");
  if (!existing.projectType) missing.push("projectType");
  if (!existing.outcome) missing.push("outcome");
  if (!existing.startDate) missing.push("startDate");
  if (!existing.targetEndDate) missing.push("targetEndDate");
  if (!existing.availabilityExpectation) missing.push("availabilityExpectation");
  if (!existing.availabilityResponseExpectation) missing.push("availabilityResponseExpectation");
  if (existing.skills.length === 0) missing.push("skills");
  if (existing.roles.length === 0) missing.push("roles");
  if (existing.milestones.length === 0) missing.push("milestones");

  // Every role must have at least one skill and an hoursPerWeek
  for (const role of existing.roles) {
    if (role.skills.length === 0) missing.push(`roles[${role.title}].skills`);
    if (!role.hoursPerWeek) missing.push(`roles[${role.title}].hoursPerWeek`);
  }

  if (missing.length > 0) {
    throw new ProjectError(
      `Cannot publish: the following required fields are missing or incomplete: ${missing.join(", ")}`
    );
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      status: "OPEN",
      publishedAt: new Date(),
      // Publishing shares the project page — that is what makes it
      // discoverable and joinable. The owner can unshare it later.
      isShared: true,
    },
    include: PROJECT_INCLUDE,
  });

  // Publishing changes status — invalidate project detail, owner list,
  // and all recommendation caches (new OPEN project may appear for others)
  await cacheDel(
    CacheKey.project(projectId),
    CacheKey.projectsMine(ownerId),
  );
  await cacheDelPattern("projects:recommended:*");

  return project;
}

// ─────────────────────────────────────────────────────────────────────────────
// getProjectById
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a single project by ID. Returns null if not found, soft-deleted, or
 * not visible to the requester.
 *
 * Visibility rules:
 *   - DRAFT   → visible to the owner only.
 *   - not shared → private to the team (owner + active members).
 *   - shared  → visible to every authenticated user.
 *
 * The cached payload is requester-independent; the access decision is always
 * made on the fresh object so an unshared project can never leak through the
 * cache.
 *
 * @param {string} projectId
 * @param {string|null} requesterId  — the authenticated user's ID (or null for public)
 * @returns {object|null}
 */
export async function getProjectById(projectId, requesterId = null) {
  const cacheKey = CacheKey.project(projectId);
  let project = await cacheGet(cacheKey);

  if (!project) {
    project = await prisma.project.findUnique({
      where: { id: projectId },
      include: PROJECT_INCLUDE,
    });
    if (!project) return null;
    // Only published projects are cached — a DRAFT is owner-only and must
    // never be served from a shared cache entry.
    if (project.status !== "DRAFT") {
      await cacheSet(cacheKey, project, TTL.PROJECT);
    }
  }

  if (!project || project.deletedAt) return null;

  if (project.status === "DRAFT") {
    return project.ownerId === requesterId ? project : null;
  }

  // Not shared → the project page is private to the team.
  if (!project.isShared) {
    if (project.ownerId === requesterId) return project;
    const isActiveMember = requesterId
      ? await prisma.projectMember.count({
          where: { projectId, userId: requesterId, status: "ACTIVE" },
        }) > 0
      : false;
    return isActiveMember ? project : null;
  }

  return project;
}

// ─────────────────────────────────────────────────────────────────────────────
// completeProject
// ─────────────────────────────────────────────────────────────────────────────

// Tasks that are still open — a project with open work is not finished.
const OPEN_TASK_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"];

/**
 * Complete a project. Only the project owner can do this.
 *
 * The server validates every requirement — the owner cannot skip a check:
 *   1. The project must be running (OPEN or IN_PROGRESS).
 *   2. The owner must enter a final outcome.
 *   3. The project must have at least one deliverable.
 *   4. Every active member must have at least one CONFIRMED contribution
 *      (the member reviews their own summary, a teammate confirms it).
 *   5. No contribution may still be waiting for a review.
 *   6. No task may still be open.
 *
 * When a check fails the error carries the failed checks so the frontend can
 * render them as a checklist.
 *
 * @param {string} projectId
 * @param {string} ownerId
 * @param {string} outcome — the final outcome the owner writes
 */
export async function completeProject(projectId, ownerId, outcome) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true, title: true, slug: true, status: true, ownerId: true,
      memberships: {
        where: { status: "ACTIVE" },
        select: {
          id: true, userId: true,
          user: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!project) throw new ProjectError("Project not found", 404);

  // Only the owner completes a project.
  if (project.ownerId !== ownerId) {
    throw new ProjectError("Only the project owner can complete this project", 403);
  }

  if (!["OPEN", "IN_PROGRESS"].includes(project.status)) {
    throw new ProjectError(
      project.status === "DRAFT"
        ? "Publish the project before completing it"
        : `This project is already ${project.status.toLowerCase().replace("_", " ")}`,
      409,
    );
  }

  const finalOutcome = (outcome ?? "").trim();
  if (!finalOutcome) {
    throw new ProjectError("A final outcome is required to complete the project", 400);
  }

  // ── Collect everything the checks need ───────────────────────────────────
  const [deliverableCount, contributions, openTaskCount] = await Promise.all([
    prisma.projectEvidence.count({ where: { projectId } }),
    prisma.contribution.findMany({
      where: { projectId },
      select: {
        id: true, status: true, title: true,
        member: { select: { userId: true } },
      },
    }),
    prisma.task.count({
      where: { projectId, status: { in: OPEN_TASK_STATUSES } },
    }),
  ]);

  const checks = [];

  // 3. At least one deliverable.
  if (deliverableCount === 0) {
    checks.push({
      code:    "NO_DELIVERABLES",
      message: "Add at least one deliverable before completing the project.",
    });
  }

  // 4. Every active member has a confirmed contribution.
  const confirmedByUser = new Set(
    contributions
      .filter((c) => c.status === "CONFIRMED")
      .map((c) => c.member.userId),
  );
  const missingConfirmation = project.memberships.filter(
    (m) => !confirmedByUser.has(m.userId),
  );
  if (missingConfirmation.length > 0) {
    checks.push({
      code:    "UNCONFIRMED_CONTRIBUTIONS",
      message: "Every member needs a confirmed contribution before the project can be completed.",
      members: missingConfirmation.map((m) => ({ id: m.user.id, name: m.user.name })),
    });
  }

  // 5. No contribution may still be waiting for a review.
  const awaitingReview = contributions.filter((c) => c.status === "PENDING_REVIEW");
  if (awaitingReview.length > 0) {
    checks.push({
      code:    "UNREVIEWED_CONTRIBUTIONS",
      message: `${awaitingReview.length} contribution${awaitingReview.length === 1 ? " is" : "s are"} still waiting for a review.`,
      contributions: awaitingReview.map((c) => ({ id: c.id, title: c.title })),
    });
  }

  // 6. No open task.
  if (openTaskCount > 0) {
    checks.push({
      code:    "OPEN_TASKS",
      message: `${openTaskCount} task${openTaskCount === 1 ? " is" : "s are"} still open.`,
      count: openTaskCount,
    });
  }

  if (checks.length > 0) {
    const error = new ProjectError("The project is not ready to be completed yet");
    error.status = 409;
    error.checks = checks;
    throw error;
  }

  // ── Complete it ───────────────────────────────────────────────────────────
  const now = new Date();

  const completed = await prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id: projectId },
      data: {
        status:           "COMPLETED",
        completedAt:      now,
        completionOutcome: finalOutcome,
      },
      include: PROJECT_INCLUDE,
    });

    await tx.activityLog.create({
      data: {
        projectId,
        actorId:  ownerId,
        action:   "project.completed",
        entityType: "project",
        entityId: projectId,
        metadata: {
          deliverableCount,
          memberCount: project.memberships.length,
          confirmedContributions: contributions.filter((c) => c.status === "CONFIRMED").length,
        },
      },
    });

    return updated;
  });

  // Tell the team the project is done (fire-and-forget, never fails the call).
  await Promise.all(
    project.memberships
      .filter((m) => m.userId !== ownerId)
      .map((m) =>
        createNotification({
          userId:     m.userId,
          type:       "PROJECT_COMPLETED",
          projectId,
          entityType: "project",
          entityId:   projectId,
          title:      `${project.title} is complete`,
          message:    `The project "${project.title}" was completed. Open it to see the final outcome and everyone's contributions.`,
          data: {
            projectId:   projectId,
            projectSlug: project.slug,
          },
          dedupeKey: `project-completed:${projectId}:${m.userId}`,
        }),
      ),
  );

  await cacheDel(
    CacheKey.project(projectId),
    CacheKey.projectsMine(ownerId),
  );
  await cacheDelPattern("projects:recommended:*");

  return completed;
}

// ─────────────────────────────────────────────────────────────────────────────
// setProjectSharing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Share or unshare a project page.
 *
 * A shared project page is visible to every authenticated user and shows up in
 * Discover / recommendations. An unshared project page is private to the team
 * (owner + active members) and disappears from the public listings.
 *
 * Only the owner can change this.
 *
 * @param {string} projectId
 * @param {string} ownerId
 * @param {boolean} isShared
 */
export async function setProjectSharing(projectId, ownerId, isShared) {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, deletedAt: true },
  });

  if (!existing || existing.deletedAt) {
    throw new ProjectError("Project not found", 404);
  }
  if (existing.ownerId !== ownerId) {
    throw new ProjectError("Only the project owner can change who can see this project", 403);
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data:  { isShared },
    select: { id: true, title: true, status: true, isShared: true },
  });

  // The shared flag is part of the cached project payload and of every
  // listing, so both caches have to go.
  await cacheDel(
    CacheKey.project(projectId),
    CacheKey.projectsMine(ownerId),
  );
  await cacheDelPattern("projects:recommended:*");

  return project;
}

// ─────────────────────────────────────────────────────────────────────────────
// getProjectsByOwner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns all non-deleted projects owned by a user, newest first.
 * Includes both drafts and published projects so the owner can see
 * everything in their dashboard.
 *
 * @param {string} ownerId
 * @returns {object[]}
 */
export async function getProjectsByOwner(ownerId) {
  return withCache(CacheKey.projectsMine(ownerId), () =>
    prisma.project.findMany({
      where: {
        ownerId,
        deletedAt: null,
      },
      include: PROJECT_INCLUDE,
      orderBy: { createdAt: "desc" },
    }), TTL.PROJECTS_MINE);
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteProject
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Soft-deletes a project by setting deletedAt. Only the owner can delete.
 * Published projects (OPEN / IN_PROGRESS) can also be deleted — they will
 * disappear from all listings immediately.
 *
 * @param {string} projectId
 * @param {string} ownerId
 * @returns {object} the updated project (with deletedAt set)
 */
export async function deleteProject(projectId, ownerId) {
  const existing = await prisma.project.findUnique({ where: { id: projectId } });

  if (!existing || existing.deletedAt) {
    throw new ProjectError("Project not found", 404);
  }
  if (existing.ownerId !== ownerId) {
    throw new ProjectError("Only the project owner can delete this project", 403);
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: { deletedAt: new Date() },
    select: { id: true, title: true, deletedAt: true },
  });

  await cacheDel(
    CacheKey.project(projectId),
    CacheKey.projectsMine(ownerId),
  );
  await cacheDelPattern("projects:recommended:*");

  return project;
}

// ─────────────────────────────────────────────────────────────────────────────
// searchProjects
// Browse / discover OPEN projects with optional filters and text search.
// Used by the Discover Projects screen.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List published OPEN projects with optional search and filters.
 *
 * Filters (all optional):
 *   q             — case-insensitive title / description substring search
 *   projectType   — exact match on the ProjectType enum
 *   skillIds[]    — project must have at least one of these skill IDs
 *   minDuration   — durationWeeks >= minDuration
 *   maxDuration   — durationWeeks <= maxDuration
 *   minHours      — weeklyHours >= minHours
 *   maxHours      — weeklyHours <= maxHours
 *   roleTitle     — case-insensitive match on at least one role title
 *
 * Always excludes soft-deleted projects and DRAFT / completed projects.
 * Results are ordered newest-published first, then paginated.
 *
 * @param {string}   userId    — used to annotate whether user is already a member
 * @param {object}   filters
 * @param {object}   pagination  { page, limit }
 * @returns {{ projects, pagination }}
 */
export async function searchProjects(userId, filters = {}, { page = 1, limit = 12 } = {}) {
  const {
    q,
    projectType,
    skillIds,
    minDuration,
    maxDuration,
    minHours,
    maxHours,
    roleTitle,
  } = filters;

  const safePage  = Math.max(1, Number(page));
  const safeLimit = Math.min(50, Math.max(1, Number(limit)));
  const skip      = (safePage - 1) * safeLimit;

  const where = {
    status:      "OPEN",
    publishedAt: { not: null },
    deletedAt:   null,
    // Only shared projects are discoverable — an unshared project page is
    // private to its team.
    isShared:    true,
    // Text search — case-insensitive match on title or description
    ...(q && {
      OR: [
        { title:       { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ],
    }),
    // Enum filter
    ...(projectType && { projectType }),
    // Duration window
    ...(minDuration !== undefined && { durationWeeks: { gte: Number(minDuration) } }),
    ...(maxDuration !== undefined && {
      durationWeeks: {
        ...(minDuration !== undefined ? { gte: Number(minDuration) } : {}),
        lte: Number(maxDuration),
      },
    }),
    // Weekly hours window
    ...(minHours !== undefined && { weeklyHours: { gte: Number(minHours) } }),
    ...(maxHours !== undefined && {
      weeklyHours: {
        ...(minHours !== undefined ? { gte: Number(minHours) } : {}),
        lte: Number(maxHours),
      },
    }),
    // Skill filter — project must carry at least one of the requested skills
    ...(skillIds?.length > 0 && {
      skills: { some: { skillId: { in: skillIds } } },
    }),
    // Role title filter — project must have at least one role with a title containing the given string (case-insensitive)
    ...(roleTitle && {
      roles: {
        some: {
          title: {
            contains: roleTitle,
            mode: "insensitive",
          },
        },
      },
    }),
  };

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      skip,
      take: safeLimit,
      include: PROJECT_INCLUDE,
    }),
    prisma.project.count({ where }),
  ]);

  return {
    projects,
    pagination: {
      total,
      page:       safePage,
      limit:      safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}
