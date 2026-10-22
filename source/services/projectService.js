import prisma from "../db/client.js";

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
    },
    include: PROJECT_INCLUDE,
  });

  return project;
}

// ─────────────────────────────────────────────────────────────────────────────
// getProjectById
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a single project by ID. Returns null if not found or soft-deleted.
 * DRAFT projects are only visible to their owner.
 *
 * @param {string} projectId
 * @param {string|null} requesterId  — the authenticated user's ID (or null for public)
 * @returns {object|null}
 */
export async function getProjectById(projectId, requesterId = null) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: PROJECT_INCLUDE,
  });

  if (!project || project.deletedAt) return null;

  // Drafts are private — only the owner can see them
  if (project.status === "DRAFT" && project.ownerId !== requesterId) {
    return null;
  }

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
  return prisma.project.findMany({
    where: {
      ownerId,
      deletedAt: null,
    },
    include: PROJECT_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
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

  return prisma.project.update({
    where: { id: projectId },
    data: { deletedAt: new Date() },
    select: { id: true, title: true, deletedAt: true },
  });
}
