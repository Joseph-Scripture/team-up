import prisma from "../db/client.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVE_PROJECT_STATUSES = ["OPEN", "IN_PROGRESS"];

// Tasks that are not done and can appear in "upcoming" or "attention" panels.
const INCOMPLETE_TASK_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"];

// SkillLevel is a Prisma enum, not a numeric value — never compare directly.
const SKILL_LEVEL_RANK = {
  BEGINNER: 1,
  INTERMEDIATE: 2,
  ADVANCED: 3,
  EXPERT: 4,
};

const DEFAULT_RECOMMENDATION_LIMIT = 6;
const MAX_RECOMMENDATION_LIMIT = 20;
const UPCOMING_WINDOW_DAYS = 7;

// ─────────────────────────────────────────────────────────────────────────────
// Custom error — matches the .status convention used across this codebase
// ─────────────────────────────────────────────────────────────────────────────

export class DashboardError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "DashboardError";
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prisma include shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dashboard project card include.
 * Separate from projectService's PROJECT_INCLUDE so that changes here
 * never affect unrelated endpoints (project detail, listing, etc.).
 *
 * Includes active member avatars, milestones, and a role list so the
 * frontend can render project cards with full context.
 */
const DASHBOARD_PROJECT_INCLUDE = {
  owner: {
    select: { id: true, name: true, avatarUrl: true, location: true },
  },
  skills: {
    include: {
      skill: { select: { id: true, name: true, slug: true, category: true } },
    },
  },
  roles: {
    orderBy: { createdAt: "asc" },
    include: {
      skills: {
        include: {
          skill: { select: { id: true, name: true, slug: true, category: true } },
        },
      },
      memberships: {
        where: { status: "ACTIVE" },
        select: { id: true },
      },
    },
  },
  memberships: {
    where: { status: "ACTIVE" },
    include: {
      user: { select: { id: true, name: true, avatarUrl: true } },
      role: { select: { id: true, title: true } },
    },
  },
  milestones: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      title: true,
      status: true,
      dueDate: true,
      sortOrder: true,
      _count: { select: { tasks: true } },
    },
  },
  _count: {
    select: { tasks: true, memberships: true, milestones: true },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Pure scoring helpers
// ─────────────────────────────────────────────────────────────────────────────

function getUpcomingWindow() {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + UPCOMING_WINDOW_DAYS);
  return { now, end };
}

function normalizeLocation(location) {
  return location?.trim().toLowerCase() || null;
}

/**
 * Recency bonus — newer projects score higher.
 * Max 10 points, decays to 1 after 90 days.
 */
function getRecencyScore(publishedAt) {
  if (!publishedAt) return 0;
  const ageInDays = (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageInDays <= 7) return 10;
  if (ageInDays <= 30) return 7;
  if (ageInDays <= 90) return 4;
  return 1;
}

/**
 * Skill compatibility for one project role.
 *
 * Required skills are worth 2×, optional skills 1×.
 * Returns a percentage (0–100), a capped score (0–40),
 * and arrays of matched / missing skills for the frontend to display.
 */
function calculateRoleSkillMatch(userSkills, roleSkills) {
  const userSkillMap = new Map(
    userSkills.map((us) => [us.skillId, us])
  );

  let matchedWeight = 0;
  let totalWeight = 0;
  const matchedSkills = [];
  const missingSkills = [];

  for (const roleSkill of roleSkills) {
    const weight = roleSkill.required ? 2 : 1;
    totalWeight += weight;

    const userSkill = userSkillMap.get(roleSkill.skillId);
    const userRank = userSkill ? (SKILL_LEVEL_RANK[userSkill.level] ?? 0) : 0;
    const minimumRank = roleSkill.minLevel ? (SKILL_LEVEL_RANK[roleSkill.minLevel] ?? 1) : 1;

    if (userSkill && userRank >= minimumRank) {
      matchedWeight += weight;
      matchedSkills.push({
        id: roleSkill.skill.id,
        name: roleSkill.skill.name,
        userLevel: userSkill.level,
        minimumLevel: roleSkill.minLevel ?? "BEGINNER",
        required: roleSkill.required,
      });
    } else {
      missingSkills.push({
        id: roleSkill.skill.id,
        name: roleSkill.skill.name,
        minimumLevel: roleSkill.minLevel ?? "BEGINNER",
        required: roleSkill.required,
      });
    }
  }

  const percentage = totalWeight === 0 ? 0 : Math.round((matchedWeight / totalWeight) * 100);
  return {
    percentage,
    matchedSkills,
    missingSkills,
    score: Math.round((percentage / 100) * 40), // max 40 points from role skill match
  };
}

/**
 * Project-level skill score — secondary to role match.
 * Capped at 20 points. Not added inside scoreRole to avoid double-counting;
 * applied once at the project level when building the final recommendation entry.
 */
function calculateProjectSkillScore(userSkills, projectSkills) {
  const userSkillMap = new Map(
    userSkills.map((us) => [us.skillId, SKILL_LEVEL_RANK[us.level] ?? 0])
  );

  let score = 0;
  for (const projectSkill of projectSkills) {
    const userRank = userSkillMap.get(projectSkill.skillId) ?? 0;
    if (userRank === 0) continue;
    const minimumRank = projectSkill.minLevel
      ? (SKILL_LEVEL_RANK[projectSkill.minLevel] ?? 1)
      : 1;
    if (userRank < minimumRank) continue;
    score += projectSkill.required ? 3 : 1;
  }
  return Math.min(score, 20);
}

/**
 * Availability score — hard filter below 50 % of required hours, soft signal above.
 *
 * Hard filter: if the user can commit less than half the role's required hours,
 * return null to signal that this role should be excluded entirely.
 * Callers must check for null and skip the role before scoring.
 *
 * Soft signal (≥ 50 % of required hours): score scales from 8 → 15.
 * Exact match or above earns the full 15 pts.
 *
 * Edge cases:
 *  - user.isAvailable === false   → null (hard exclude)
 *  - role has no hoursPerWeek     → 7 pts (neutral, no filter applied)
 *  - user has no weeklyAvailabilityHours → 5 pts (neutral, no filter applied)
 *
 * Max 15 points.
 */
function calculateAvailabilityScore(user, role) {
  if (!user.isAvailable) return null;
  const expectedHours = role.hoursPerWeek;
  if (expectedHours == null) return 7; // role has no hours set — neutral
  if (user.weeklyAvailabilityHours == null) return 5; // user hasn't specified — neutral
  if (expectedHours <= 0) return 15;

  // Hard filter: user can commit less than half the required hours.
  if (user.weeklyAvailabilityHours < expectedHours / 2) return null;

  if (user.weeklyAvailabilityHours >= expectedHours) return 15;

  // Soft signal: scale 8–14 pts proportionally between 50 % and 100 % coverage.
  const coverage = user.weeklyAvailabilityHours / expectedHours; // 0.5 … <1.0
  return Math.round(8 + (coverage - 0.5) * 2 * (15 - 8));
}

/**
 * Duration preference score. Max 10 points.
 */
function calculateDurationScore(user, project) {
  const preferredWeeks = user.preferredProjectDurationWeeks;
  if (preferredWeeks == null || project.durationWeeks == null || project.durationWeeks <= 0) {
    return 5; // neutral when data is missing
  }
  const diff = Math.abs(preferredWeeks - project.durationWeeks);
  if (diff === 0) return 10;
  if (diff <= 2) return 8;
  if (diff <= 4) return 5;
  if (diff <= 8) return 3;
  return 0;
}

/**
 * Location score — intentionally weak signal (free-text field, no geo data).
 * Max 5 points. Timezone is not compared against availabilityExpectation
 * because that field is free-text commitment copy, not a timezone value.
 */
function calculateLocationScore(user, project) {
  const userLocation = normalizeLocation(user.location);
  const ownerLocation = normalizeLocation(project.owner?.location);
  if (!userLocation || !ownerLocation) return 0;
  return userLocation === ownerLocation ? 5 : 0;
}

/**
 * Score one open role against the user's profile.
 * Returns null if the role fails a hard filter (availability).
 *
 * Role skill match:   max 40 pts
 * Availability match: max 15 pts
 * Duration match:     max 10 pts
 * Location match:     max  5 pts
 * Recency bonus:      max 10 pts
 * ─────────────────────────────
 * Total (role):       max 80 pts
 *
 * Project skill match is added at the project level (not here),
 * capped at 20 pts, bringing the overall maximum to 100.
 */
function scoreRole(user, project, role) {
  const availabilityScore = calculateAvailabilityScore(user, role);

  // Hard filter — user cannot meet the minimum hour commitment for this role.
  if (availabilityScore === null) return null;

  const roleSkillMatch = calculateRoleSkillMatch(user.skills, role.skills);
  const durationScore = calculateDurationScore(user, project);
  const locationScore = calculateLocationScore(user, project);
  const recencyScore = getRecencyScore(project.publishedAt);

  // When the role has required skills, apply a skill-match multiplier so that
  // non-skill signals (availability, recency, duration) cannot push a role with
  // 0% required-skill coverage above roles the user actually qualifies for.
  // Roles with no skills defined are unaffected (multiplier = 1).
  const hasRequiredSkills = role.skills.some((rs) => rs.required);
  const skillMultiplier = hasRequiredSkills
    ? roleSkillMatch.percentage / 100
    : 1;

  const rawScore = roleSkillMatch.score + availabilityScore + durationScore + locationScore + recencyScore;
  const score = Math.min(80, Math.round(rawScore * skillMultiplier));

  return {
    ...role,
    openSlots: Math.max(0, role.requiredMembers - role.memberships.length),
    matchScore: score,
    matchedSkills: roleSkillMatch.matchedSkills,
    missingSkills: roleSkillMatch.missingSkills,
    skillMatchPercentage: roleSkillMatch.percentage,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getRecommendedProjects
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find and rank OPEN projects with available roles the user could join.
 *
 * Hard filters (must all pass):
 *  - Project status = OPEN and publishedAt is set
 *  - Project is not soft-deleted
 *  - User is not already an ACTIVE member
 *  - User has no PENDING join request for the project
 *  - User has no PENDING invitation for the project
 *  - At least one role is OPEN with remaining capacity
 *
 * Scoring (see scoreRole + calculateProjectSkillScore above):
 *  - Role skill match (40 pts max) — highest-weight signal
 *  - Availability match (15 pts max) — can the user commit the hours?
 *  - Duration preference (10 pts max)
 *  - Recency (10 pts max)
 *  - Project-level skill overlap (20 pts max) — secondary signal
 *  - Location match (5 pts max) — weak tie-breaker
 *
 * The best-matching open role is attached as `recommendedRole` so the
 * frontend can explain WHY a project was recommended ("You match the
 * Frontend Developer role").
 *
 * @param {string} userId
 * @param {object} userContext — pre-fetched user object from getDashboardData to avoid a second DB round-trip
 * @param {number} limit
 */
export async function getRecommendedProjects(userId, userContext, limit = DEFAULT_RECOMMENDATION_LIMIT) {
  const safeLimit = Math.min(
    MAX_RECOMMENDATION_LIMIT,
    Math.max(1, Number.parseInt(limit, 10) || DEFAULT_RECOMMENDATION_LIMIT)
  );

  // Fetch the user's skills (not included in the lean userContext from getDashboardData).
  const userWithSkills = await prisma.user.findFirst({
    where: { id: userId, status: "ACTIVE", deletedAt: null },
    select: {
      id: true,
      location: true,
      isAvailable: true,
      weeklyAvailabilityHours: true,
      preferredProjectDurationWeeks: true,
      skills: { select: { skillId: true, level: true } },
    },
  });

  if (!userWithSkills) {
    throw new DashboardError("User not found or inactive", 404);
  }

  // Fetch more than the limit because some candidates may have no remaining
  // capacity after checking requiredMembers vs. active membership count.
  const candidates = await prisma.project.findMany({
    where: {
      status: "OPEN",
      publishedAt: { not: null },
      deletedAt: null,
      memberships: { none: { userId, status: "ACTIVE" } },
      joinRequests: { none: { requesterId: userId, status: "PENDING" } },
      invitations: { none: { inviteeId: userId, status: "PENDING" } },
      roles: { some: { status: "OPEN" } },
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: Math.min(safeLimit * 5, 100),
    include: {
      owner: {
        select: { id: true, name: true, avatarUrl: true, location: true },
      },
      skills: {
        include: {
          skill: { select: { id: true, name: true, slug: true } },
        },
      },
      roles: {
        where: { status: "OPEN" },
        include: {
          skills: {
            include: {
              skill: { select: { id: true, name: true, slug: true } },
            },
          },
          memberships: {
            where: { status: "ACTIVE" },
            select: { id: true },
          },
        },
      },
      _count: { select: { memberships: true, milestones: true } },
    },
  });

  const recommendations = [];

  for (const project of candidates) {
    // Only consider roles that still have open slots AND have at least one
    // skill defined. A role with no skills is incomplete data — recommending
    // it would surface projects purely on availability/recency signals with
    // no skill relevance, which produces misleading results.
    const availableRoles = project.roles.filter(
      (role) =>
        role.memberships.length < role.requiredMembers &&
        role.skills.length > 0
    );
    if (availableRoles.length === 0) continue;

    // Score each available role independently. scoreRole returns null when a
    // role fails a hard filter (e.g. user can't meet the hour commitment).
    const scoredRoles = availableRoles
      .map((role) => scoreRole(userWithSkills, project, role))
      .filter((role) => role !== null)
      .sort((a, b) => b.matchScore - a.matchScore);

    // If every role in this project was hard-filtered out, skip the project.
    if (scoredRoles.length === 0) continue;

    const bestRole = scoredRoles[0];

    // Project-level skill bonus applied once here — NOT inside scoreRole —
    // to avoid double-counting. Contributes up to 20 pts.
    //
    // Only applied when the best role has a non-zero score. A project where
    // every role scored 0 (no skill match) should not be surfaced purely
    // because the user shares a project-level skill tag.
    if (bestRole.matchScore === 0) continue;

    const projectSkillBonus = calculateProjectSkillScore(userWithSkills.skills, project.skills);

    const finalScore = Math.min(100, bestRole.matchScore + projectSkillBonus);

    recommendations.push({
      ...project,
      roles: scoredRoles,
      // The role the frontend should highlight as the reason for the recommendation.
      recommendedRole: {
        id: bestRole.id,
        title: bestRole.title,
        description: bestRole.description,
        hoursPerWeek: bestRole.hoursPerWeek,
        openSlots: bestRole.openSlots,
        matchScore: bestRole.matchScore,
        skillMatchPercentage: bestRole.skillMatchPercentage,
        matchedSkills: bestRole.matchedSkills,
        missingSkills: bestRole.missingSkills,
      },
      matchScore: finalScore,
    });
  }

  return recommendations
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      // Tie-break: more recently published first.
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    })
    .slice(0, safeLimit);
}

// ─────────────────────────────────────────────────────────────────────────────
// getDashboardData
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aggregate everything the dashboard needs in as few round-trips as possible.
 *
 * Returns one of two views:
 *   "PROJECTS"  — user has active owned or member projects; shows workspace.
 *   "DISCOVERY" — no active projects; shows personalised recommendations.
 *
 * If onboarding is not complete, returns early with an onboarding flag and
 * empty arrays so the frontend can redirect without additional logic.
 *
 * @param {string} userId
 * @param {object} options
 * @param {number} [options.recommendationLimit=6]
 */
export async function getDashboardData(userId, { recommendationLimit = DEFAULT_RECOMMENDATION_LIMIT } = {}) {
  // ── 1. Fetch lean user profile ────────────────────────────────────────────
  const user = await prisma.user.findFirst({
    where: { id: userId, status: "ACTIVE", deletedAt: null },
    select: {
      id: true,
      name: true,
      headline: true,
      avatarUrl: true,
      location: true,
      timezone: true,
      isAvailable: true,
      weeklyAvailabilityHours: true,
      preferredProjectDurationWeeks: true,
      onboardingCompletedAt: true,
    },
  });

  if (!user) {
    throw new DashboardError("User not found or inactive", 404);
  }

  // ── 2. Onboarding gate ────────────────────────────────────────────────────
  // Skills, availability, and duration preference are all set during onboarding.
  // Without them the recommendation engine produces meaningless results, and
  // the project workspace view is also unlikely to have useful data.
  if (!user.onboardingCompletedAt) {
    return {
      user: { id: user.id, name: user.name, headline: user.headline, avatarUrl: user.avatarUrl },
      onboarding: { completed: false, completedAt: null },
      view: "ONBOARDING",
      ownedProjects: [],
      memberProjects: [],
      attentionTasks: [],
      upcomingTasks: [],
      pendingInvitations: [],
      recommendedProjects: [],
      summary: {
        activeProjects: 0,
        attentionTasks: 0,
        upcomingTasks: 0,
        pendingInvitations: 0,
      },
    };
  }

  const { now, end } = getUpcomingWindow();

  // ── 3. Run all independent queries in parallel ────────────────────────────
  const activeMembershipFilter = { userId, status: "ACTIVE" };

  const [ownedProjects, memberProjects, attentionTasks, upcomingTasks, pendingInvitations] =
    await Promise.all([

      // Owner sees their projects including DRAFT so they can continue editing.
      // Members should not see DRAFT projects they didn't create.
      prisma.project.findMany({
        where: { ownerId: userId, deletedAt: null },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        include: DASHBOARD_PROJECT_INCLUDE,
      }),

      // Projects the user joined but does not own — ACTIVE membership only.
      // Only surfaces OPEN / IN_PROGRESS projects (the owner handles DRAFTs above).
      prisma.project.findMany({
        where: {
          deletedAt: null,
          status: { in: ACTIVE_PROJECT_STATUSES },
          ownerId: { not: userId }, // exclude owned projects (already in ownedProjects)
          memberships: { some: activeMembershipFilter },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        include: DASHBOARD_PROJECT_INCLUDE,
      }),

      // Tasks that need attention: BLOCKED or overdue on an active project.
      prisma.task.findMany({
        where: {
          project: { deletedAt: null, status: { in: ACTIVE_PROJECT_STATUSES } },
          assignee: { is: activeMembershipFilter },
          OR: [
            { status: "BLOCKED" },
            {
              dueDate: { lt: now },
              status: { notIn: ["COMPLETED", "CANCELLED"] },
            },
          ],
        },
        orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
        take: 10,
        include: {
          project: { select: { id: true, title: true, slug: true } },
          milestone: { select: { id: true, title: true } },
          assignee: {
            select: {
              id: true,
              role: { select: { id: true, title: true } },
            },
          },
        },
      }),

      // Tasks due in the next 7 days, excluding completed/cancelled work.
      // A BLOCKED task can appear in both panels simultaneously — that is intentional.
      prisma.task.findMany({
        where: {
          project: { deletedAt: null, status: { in: ACTIVE_PROJECT_STATUSES } },
          assignee: { is: activeMembershipFilter },
          dueDate: { gte: now, lte: end },
          status: { in: INCOMPLETE_TASK_STATUSES },
        },
        orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
        take: 10,
        include: {
          project: { select: { id: true, title: true, slug: true } },
          milestone: { select: { id: true, title: true } },
        },
      }),

      // Pending invitations — only non-expired ones.
      prisma.projectInvitation.findMany({
        where: {
          inviteeId: userId,
          status: "PENDING",
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          project: { deletedAt: null },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          project: {
            select: { id: true, title: true, slug: true, description: true, status: true },
          },
          inviter: { select: { id: true, name: true, avatarUrl: true } },
          role: { select: { id: true, title: true, hoursPerWeek: true } },
        },
      }),
    ]);

  // ── 4. Aggregate task counts per project by status ────────────────────────
  // Prisma's _count does not support `where` on sub-counts, so we use groupBy.
  const allProjectIds = [
    ...ownedProjects.map((p) => p.id),
    ...memberProjects.map((p) => p.id),
  ];

  const taskStatusGroups = allProjectIds.length
    ? await prisma.task.groupBy({
        by: ["projectId", "status"],
        where: { projectId: { in: allProjectIds } },
        _count: { _all: true },
      })
    : [];

  const taskCountsByProject = new Map();
  for (const group of taskStatusGroups) {
    if (!taskCountsByProject.has(group.projectId)) {
      taskCountsByProject.set(group.projectId, {});
    }
    taskCountsByProject.get(group.projectId)[group.status] = group._count._all;
  }

  const withTaskCounts = (project) => ({
    ...project,
    taskCounts: {
      TODO: 0,
      IN_PROGRESS: 0,
      BLOCKED: 0,
      IN_REVIEW: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      ...(taskCountsByProject.get(project.id) ?? {}),
    },
  });

  const ownedWithCounts = ownedProjects.map(withTaskCounts);
  const memberWithCounts = memberProjects.map(withTaskCounts);

  // ── 5. Decide view and fetch recommendations when needed ──────────────────
  // "Active" here means the user has work to display — OPEN or IN_PROGRESS.
  // A user who only has DRAFTs is nudged toward discovery too.
  const activeOwned = ownedWithCounts.filter((p) =>
    ACTIVE_PROJECT_STATUSES.includes(p.status)
  );
  const hasActiveWork = activeOwned.length > 0 || memberWithCounts.length > 0;

  const recommendedProjects = hasActiveWork
    ? []
    : await getRecommendedProjects(userId, user, recommendationLimit);

  return {
    user: { id: user.id, name: user.name, headline: user.headline, avatarUrl: user.avatarUrl },
    onboarding: { completed: true, completedAt: user.onboardingCompletedAt },
    // PROJECTS → show the workspace view; DISCOVERY → show recommendations
    view: hasActiveWork ? "PROJECTS" : "DISCOVERY",
    ownedProjects: ownedWithCounts,
    memberProjects: memberWithCounts,
    attentionTasks,
    upcomingTasks,
    pendingInvitations,
    recommendedProjects,
    summary: {
      activeProjects: activeOwned.length + memberWithCounts.length,
      attentionTasks: attentionTasks.length,
      upcomingTasks: upcomingTasks.length,
      pendingInvitations: pendingInvitations.length,
    },
  };
}
