import prisma from "../db/client.js";
import { resolveVisibility } from "./profileVisibilityService.js";
import { deleteCloudinaryAsset } from "./uploadService.js";
import { createNotification } from "./notificationService.js";

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
  // AI-matching fields
  professionalRole: true,
  collaborationDuration: true,
  collaborationGoals: true,
  projectInterests: true,
  workMode: true,
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

// ─────────────────────────────────────────────────────────────────────────────
// updateProfile
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Partial update of the authenticated user's profile.
 * Only fields included in the request body are written — undefined fields
 * are left unchanged. Skills are replaced entirely when provided.
 *
 * avatarUrl is accepted here as the Cloudinary fileUrl returned after the
 * client uploads the image via POST /api/uploads?context=avatar.
 * Replacing or clearing it deletes the previous Cloudinary asset.
 *
 * @param {string} userId
 * @param {object} data  — any subset of profile fields
 */
export async function updateProfile(userId, data) {
  const { skills, ...scalarFields } = data;

  // Build the scalar update — only include keys that were actually sent
  const scalarUpdate = {};
  const UPDATABLE = [
    "name", "headline", "bio", "goals", "location", "timezone",
    "githubUrl", "portfolioUrl", "avatarUrl",
    "weeklyAvailabilityHours", "preferredProjectDurationWeeks", "isAvailable",
    // AI-matching fields
    "professionalRole", "collaborationDuration", "collaborationGoals",
    "projectInterests", "workMode",
  ];
  for (const key of UPDATABLE) {
    if (scalarFields[key] !== undefined) scalarUpdate[key] = scalarFields[key];
  }

  // Capture the old avatar before the update so it can be cleaned up after.
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  });

  // If skills are provided, validate and replace them
  if (skills !== undefined) {
    const uniqueSkills = [...new Map(skills.map((s) => [s.skillId, s])).values()];
    const found = await prisma.skill.count({
      where: { id: { in: uniqueSkills.map((s) => s.skillId) } },
    });
    if (found !== uniqueSkills.length) {
      throw new HttpError(400, "One or more skills do not exist");
    }

    const user = await prisma.$transaction(async (tx) => {
      await tx.userSkill.deleteMany({ where: { userId } });
      if (uniqueSkills.length > 0) {
        await tx.userSkill.createMany({
          data: uniqueSkills.map((s) => ({
            userId,
            skillId: s.skillId,
            level:   s.level,
          })),
        });
      }
      return tx.user.update({
        where:  { id: userId },
        data:   scalarUpdate,
        select: profileSelect,
      });
    });

    if (existing?.avatarUrl && existing.avatarUrl !== user.avatarUrl) {
      void deleteCloudinaryAsset(existing.avatarUrl);
    }
    return toResponse(user);
  }

  // No skills — simple scalar update
  const user = await prisma.user.update({
    where:  { id: userId },
    data:   scalarUpdate,
    select: profileSelect,
  });

  if (existing?.avatarUrl && existing.avatarUrl !== user.avatarUrl) {
    void deleteCloudinaryAsset(existing.avatarUrl);
  }
  return toResponse(user);
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

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  });

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

  if (existing?.avatarUrl && existing.avatarUrl !== user.avatarUrl) {
    void deleteCloudinaryAsset(existing.avatarUrl);
  }

  return toResponse(user);
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteUserProfile
// Soft-delete + anonymise. The User row is never removed from the DB because
// several relations use onDelete: Restrict (owned Projects, Tasks, Comments,
// TeamUpdates, ContributionReviews, ProjectEvidence). Instead we:
//   1. Revoke all sessions so existing access tokens stop working immediately.
//   2. Cancel pending invitations and join requests so other users aren't left
//      waiting on a ghost account.
//   3. End active memberships, unassign their open tasks, and reopen full roles.
//   4. Anonymise the User row and mark it deleted + deactivated.
//   5. Notify each affected project's owner and managers.
//   6. Best-effort delete the avatar from Cloudinary (fire-and-forget).
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteUserProfile(userId) {
  // Fetch identity details before we anonymise them.
  const existing = await prisma.user.findUnique({
    where:  { id: userId },
    select: { name: true, avatarUrl: true },
  });
  if (!existing) throw new HttpError(404, "User not found");

  const memberships = await prisma.$transaction(async (tx) => {
    const now = new Date();

    // 1. Revoke all active sessions — authenticate checks revokedAt on every
    //    request, so this immediately blocks any further use of live tokens.
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data:  { revokedAt: now },
    });

    // 2. Cancel pending outbound invitations (sent by this user as owner/manager).
    await tx.projectInvitation.updateMany({
      where: { inviterId: userId, status: "PENDING" },
      data:  { status: "CANCELLED" },
    });

    // 3. Cancel pending inbound invitations (received by this user).
    await tx.projectInvitation.updateMany({
      where: { inviteeId: userId, status: "PENDING" },
      data:  { status: "CANCELLED" },
    });

    // 4. Withdraw pending and approved join requests made by this user.
    await tx.joinRequest.updateMany({
      where: { requesterId: userId, status: { in: ["PENDING", "ACCEPTED"] } },
      data:  { status: "WITHDRAWN" },
    });

    // 5. End each active membership with the same cleanup as leave/release:
    //    unassign non-terminal tasks, then reopen a role that was full.
    const activeMemberships = await tx.projectMember.findMany({
      where: { userId, status: "ACTIVE" },
      select: {
        id: true,
        roleId: true,
        role: { select: { id: true, title: true, status: true } },
        project: {
          select: {
            id: true,
            title: true,
            ownerId: true,
            memberships: {
              where: { status: "ACTIVE", accessRole: "MANAGER" },
              select: { userId: true },
            },
          },
        },
      },
    });

    for (const membership of activeMemberships) {
      await tx.projectMember.update({
        where: { id: membership.id },
        data: {
          status: "LEFT",
          endedAt: now,
          endReason: "Account deleted",
        },
      });

      // Unassign open work so no deadlines/overdue alerts keep targeting the
      // deleted account. Completed/cancelled tasks keep their history.
      await tx.task.updateMany({
        where: {
          projectId: membership.project.id,
          assigneeMemberId: membership.id,
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
        data: { assigneeMemberId: null },
      });

      // A full role must become discoverable again now that a slot is free.
      if (membership.roleId && membership.role?.status === "CLOSED") {
        await tx.projectRole.update({
          where: { id: membership.roleId },
          data:  { status: "OPEN" },
        });
      }
    }

    // 6. Soft-delete + anonymise the User row.
    //    PII is cleared so the row satisfies GDPR-style right-to-erasure
    //    without breaking referential integrity.
    await tx.user.update({
      where: { id: userId },
      data: {
        deletedAt:    now,
        status:       "DEACTIVATED",
        // Anonymise identity fields.
        name:         "Deleted User",
        email:        `deleted+${userId}@teamup.invalid`,
        passwordHash: "",
        // Clear all profile content.
        headline:          null,
        bio:               null,
        goals:             null,
        location:          null,
        timezone:          null,
        avatarUrl:         null,
        githubUrl:         null,
        portfolioUrl:      null,
        visibilitySettings: null,
        // Mark unavailable so they don't appear in recommendations.
        isAvailable:       false,
      },
    });

    return activeMemberships;
  });

  // 7. Tell each affected project who left and why. Recipients are the owner
  //    plus active managers, excluding the deleted account itself.
  await Promise.all(
    memberships.flatMap((membership) => {
      const recipientIds = new Set([
        membership.project.ownerId,
        ...membership.project.memberships.map(({ userId: managerId }) => managerId),
      ]);
      recipientIds.delete(userId);

      const roleLabel = membership.role?.title
        ? ` Their ${membership.role.title} role is open again.`
        : "";

      return [...recipientIds].map((recipientId) =>
        createNotification({
          userId:     recipientId,
          type:       "MEMBER_LEFT",
          projectId:  membership.project.id,
          entityType: "membership",
          entityId:   membership.id,
          title:      `A member left ${membership.project.title}`,
          message:    `${existing.name} left ${membership.project.title} because their account was deleted.${roleLabel}`,
          data: {
            projectId: membership.project.id,
            roleTitle: membership.role?.title ?? null,
            reason: "ACCOUNT_DELETED",
          },
          dedupeKey: `member-left:${membership.id}`,
        }),
      );
    }),
  );

  // 8. Best-effort Cloudinary cleanup — runs outside the transaction so a
  //    Cloudinary failure never rolls back the deletion.
  if (existing.avatarUrl) {
    void deleteCloudinaryAsset(existing.avatarUrl);
  }
}
