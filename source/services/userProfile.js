import prisma from "../db/client.js";
import { resolveVisibility } from "./profileVisibilityService.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const profileSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  headline: true,
  bio: true,
  goals: true,
  location: true,
  timezone: true,
  githubUrl: true,
  portfolioUrl: true,
  avatarUrl: true,
  weeklyAvailabilityHours: true,
  preferredProjectDurationWeeks: true,
  isAvailable: true,
  onboardingCompletedAt: true,
  visibilitySettings: true,
  skills: {
    select: {
      level: true,
      skill: { select: { id: true, name: true, slug: true } },
    },
  },
};

// Hide the raw timestamp; the frontend only needs a boolean.
// Also resolve visibilitySettings so the owner always gets a complete object.
function toResponse({ onboardingCompletedAt, visibilitySettings, ...rest }) {
  return {
    ...rest,
    onboardingCompleted: !!onboardingCompletedAt,
    visibilitySettings:  resolveVisibility(visibilitySettings),
  };
}

export async function getProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: profileSelect,
  });
  return user ? toResponse(user) : null;
}

export async function completeOnboarding(userId, { skills, ...profile }) {
  // Remove duplicate skills; the last one the user picked wins.
  const uniqueSkills = [...new Map(skills.map((s) => [s.skillId, s])).values()];

  // Every selected skill must exist in the catalogue.
  const found = await prisma.skill.count({
    where: { id: { in: uniqueSkills.map((s) => s.skillId) } },
  });
  if (found !== uniqueSkills.length) {
    throw new HttpError(400, "One or more skills do not exist");
  }

  const user = await prisma.$transaction(async (tx) => {
    // Replace the user's skill set in one transaction (no half-saved state).
    await tx.userSkill.deleteMany({ where: { userId } });
    await tx.userSkill.createMany({
      data: uniqueSkills.map((s) => ({ userId, skillId: s.skillId, level: s.level })),
    });

    return tx.user.update({
      where: { id: userId },
      data: { ...profile, onboardingCompletedAt: new Date() },
      select: profileSelect,
    });
  });

  return toResponse(user);
}