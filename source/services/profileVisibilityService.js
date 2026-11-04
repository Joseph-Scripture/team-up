import prisma from "../db/client.js";

// ─────────────────────────────────────────────────────────────────────────────
// Default visibility — all fields public.
// NULL in the DB is treated identically to this object.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_VISIBILITY = {
  showName:              true,
  showHeadline:          true,
  showSkills:            true,
  showSkillLevels:       true,
  showGoals:             true,
  showAvailability:      true,
  showPreferredDuration: true,
};

export class VisibilityError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name   = "VisibilityError";
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge stored settings with defaults so callers always get a complete object.
 */
export function resolveVisibility(stored) {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_VISIBILITY };
  return { ...DEFAULT_VISIBILITY, ...stored };
}

/**
 * Apply visibility settings to a raw user object, removing fields the user
 * has hidden. Fields omitted rather than set to null — frontend never has to
 * distinguish "empty" from "hidden".
 *
 * Always included regardless of settings: id, avatarUrl (identity anchors).
 * Never included regardless of settings: email, passwordHash, status, etc.
 */
export function applyVisibilityFilter(user, settings) {
  const v = resolveVisibility(settings);

  const result = {
    id:       user.id,
    avatarUrl: user.avatarUrl ?? null,
  };

  if (v.showName)              result.name              = user.name;
  if (v.showHeadline)          result.headline          = user.headline ?? null;
  if (v.showGoals)             result.goals             = user.goals    ?? null;
  if (v.showAvailability) {
    result.isAvailable             = user.isAvailable;
    result.weeklyAvailabilityHours = user.weeklyAvailabilityHours ?? null;
  }
  if (v.showPreferredDuration) result.preferredProjectDurationWeeks = user.preferredProjectDurationWeeks ?? null;

  if (v.showSkills && user.skills) {
    result.skills = user.skills.map((us) => ({
      skill: us.skill,
      // Only include the level if showSkillLevels is also true
      ...(v.showSkillLevels && { level: us.level }),
    }));
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// getVisibilitySettings  (owner — full settings)
// ─────────────────────────────────────────────────────────────────────────────

export async function getVisibilitySettings(userId) {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { visibilitySettings: true },
  });
  if (!user) throw new VisibilityError("User not found", 404);
  return resolveVisibility(user.visibilitySettings);
}

// ─────────────────────────────────────────────────────────────────────────────
// updateVisibilitySettings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge incoming settings with the user's current settings and persist.
 * Sending a partial object only changes the specified keys.
 *
 * @param {string} userId
 * @param {object} incoming — partial or full visibility settings object
 */
export async function updateVisibilitySettings(userId, incoming) {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { visibilitySettings: true },
  });
  if (!user) throw new VisibilityError("User not found", 404);

  const current = resolveVisibility(user.visibilitySettings);
  const merged  = { ...current, ...incoming };

  // Strip any keys that are not part of the known visibility flags.
  const known = Object.keys(DEFAULT_VISIBILITY);
  const clean = Object.fromEntries(
    Object.entries(merged).filter(([k]) => known.includes(k)),
  );

  await prisma.user.update({
    where: { id: userId },
    data:  { visibilitySettings: clean },
  });

  return clean;
}

// ─────────────────────────────────────────────────────────────────────────────
// getPublicProfile
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return a user's public profile, filtered by their visibility settings.
 *
 * @param {string} targetUserId — user whose profile is being viewed
 * @param {string} requesterId  — authenticated user making the request
 */
export async function getPublicProfile(targetUserId, requesterId) {
  const user = await prisma.user.findFirst({
    where:  { id: targetUserId, status: "ACTIVE", deletedAt: null },
    select: {
      id: true, name: true, avatarUrl: true,
      headline: true, bio: true, goals: true,
      isAvailable: true, weeklyAvailabilityHours: true,
      preferredProjectDurationWeeks: true,
      visibilitySettings: true,
      skills: {
        select: {
          level: true,
          skill: { select: { id: true, name: true, slug: true, category: true } },
        },
      },
    },
  });

  if (!user) throw new VisibilityError("User not found", 404);

  // Owner always sees their own full profile
  if (targetUserId === requesterId) {
    const { visibilitySettings, ...rest } = user;
    return {
      ...rest,
      visibilitySettings: resolveVisibility(visibilitySettings),
      isOwnProfile: true,
    };
  }

  const { visibilitySettings, ...rest } = user;
  return {
    ...applyVisibilityFilter(rest, visibilitySettings),
    isOwnProfile: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getCompletedProjects
// ─────────────────────────────────────────────────────────────────────────────

const PROJECTS_PER_PAGE = 10;
const MAX_PER_PAGE      = 50;

/**
 * Return paginated completed projects for a user — both projects they own
 * and projects they were a member of.
 *
 * Always visible regardless of visibility settings (portfolio/track record).
 *
 * @param {string} targetUserId
 * @param {object} opts
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=10]
 */
export async function getCompletedProjects(targetUserId, { page = 1, limit = PROJECTS_PER_PAGE } = {}) {
  // Confirm the user exists
  const user = await prisma.user.findFirst({
    where:  { id: targetUserId, status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true },
  });
  if (!user) throw new VisibilityError("User not found", 404);

  const safePage  = Math.max(1, Number(page));
  const safeLimit = Math.min(MAX_PER_PAGE, Math.max(1, Number(limit)));
  const skip      = (safePage - 1) * safeLimit;

  // Projects where the user is owner OR active/past member, with COMPLETED status
  const where = {
    status:    "COMPLETED",
    deletedAt: null,
    OR: [
      { ownerId: targetUserId },
      { memberships: { some: { userId: targetUserId } } },
    ],
  };

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: { completedAt: "desc" },
      skip,
      take: safeLimit,
      select: {
        id: true, title: true, slug: true,
        description: true, projectType: true,
        durationWeeks: true, weeklyHours: true,
        startDate: true, targetEndDate: true,
        completedAt: true,
        owner: { select: { id: true, name: true, avatarUrl: true } },
        skills: {
          include: {
            skill: { select: { id: true, name: true, slug: true, category: true } },
          },
        },
        // Fetch the user's membership on this project for role context
        memberships: {
          where: { userId: targetUserId },
          select: {
            accessRole: true,
            joinedAt:   true,
            endedAt:    true,
            role: { select: { id: true, title: true } },
          },
        },
        // Fetch contributions by this user on this project
        contributions: {
          where: {
            member: { userId: targetUserId },
            status: "CONFIRMED",
          },
          orderBy: { confirmedAt: "desc" },
          select: {
            id: true, title: true, description: true,
            confirmedAt: true,
            evidence: {
              select: { id: true, url: true, type: true, title: true },
            },
          },
        },
        _count: { select: { memberships: true } },
      },
    }),
    prisma.project.count({ where }),
  ]);

  return {
    user:  { id: user.id, name: user.name },
    projects,
    pagination: {
      total,
      page:       safePage,
      limit:      safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}
