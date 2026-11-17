import prisma from "../db/client.js";
import { resolveVisibility } from "./profileVisibilityService.js";
import { deleteCloudinaryAsset } from "./uploadService.js";
import { createNotification } from "./notificationService.js";
import { CacheKey, cacheDel, cacheDelPattern } from "../lib/cache.js";

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
//   4. Withdraw pending deadline-extension requests and drop outstanding
//      auth tokens (password reset / email verification).
//   5. Hand over the projects this account owned to an active manager (or the
//      longest-standing member) so no project is left without an owner; close
//      the project when nobody is left on the team.
//   6. Anonymise the User row and mark it deleted + deactivated.
//   7. Notify each affected project's owner and managers.
//   8. Best-effort delete the avatar from Cloudinary (fire-and-forget).
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
    // Projects whose ownership moves to a successor member (or that get closed
    // because nobody is left). Collected here and notified after the commit.
    const ownershipTransfers = [];

    // 1. Revoke all active sessions — authenticate checks revokedAt on every
    //    request, so this immediately blocks any further use of live tokens.
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data:  { revokedAt: now },
    });

    // 2. Cancel pending invitations in both directions (sent by this user as
    //    owner/manager, and received by this user) in a single statement.
    await tx.projectInvitation.updateMany({
      where: {
        status: "PENDING",
        OR: [{ inviterId: userId }, { inviteeId: userId }],
      },
      data: { status: "CANCELLED" },
    });

    // 3. Withdraw pending and approved join requests made by this user.
    await tx.joinRequest.updateMany({
      where: { requesterId: userId, status: { in: ["PENDING", "ACCEPTED"] } },
      data:  { status: "WITHDRAWN" },
    });

    // 4. Withdraw pending deadline-extension requests made by this user, so
    //    owners/managers are not left reviewing a request from a ghost account.
    await tx.dateExtensionRequest.updateMany({
      where: { requesterId: userId, status: "PENDING" },
      data:  { status: "WITHDRAWN" },
    });

    // 5. Invalidate every outstanding auth token (password reset, email
    //    verification). A link issued before the deletion must not work.
    await tx.authToken.deleteMany({ where: { userId } });

    // 6. End each active membership with the same cleanup as leave/release:
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

    if (activeMemberships.length > 0) {
      const memberIds = activeMemberships.map((m) => m.id);

      // End every membership at once.
      await tx.projectMember.updateMany({
        where: { id: { in: memberIds } },
        data: {
          status:    "LEFT",
          endedAt:   now,
          endReason: "Account deleted",
        },
      });

      // Unassign open work so no deadlines/overdue alerts keep targeting the
      // deleted account. Completed/cancelled tasks keep their history.
      await tx.task.updateMany({
        where: {
          assigneeMemberId: { in: memberIds },
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
        data: { assigneeMemberId: null },
      });

      // A full role must become discoverable again now that a slot is free.
      const roleIds = activeMemberships.map((m) => m.roleId).filter(Boolean);
      if (roleIds.length > 0) {
        await tx.projectRole.updateMany({
          where: { id: { in: roleIds }, status: "CLOSED" },
          data:  { status: "OPEN" },
        });
      }
    }

    // 7. Projects owned by this account must not be left ownerless.
    //    A project whose owner no longer exists can never be managed again
    //    (no one can approve join requests, publish, or close it), so
    //    ownership is handed to an active manager — or, failing that, to the
    //    longest-standing member. A project with nobody left is closed.
    const ownedProjects = await tx.project.findMany({
      where: { ownerId: userId, deletedAt: null },
      select: {
        id: true, title: true, slug: true,
        memberships: {
          where: { status: "ACTIVE", userId: { not: userId } },
          orderBy: { joinedAt: "asc" },
          select: {
            id: true, userId: true, accessRole: true,
            user: { select: { name: true } },
          },
        },
      },
    });

    for (const project of ownedProjects) {
      const successor =
        project.memberships.find((m) => m.accessRole === "MANAGER") ??
        project.memberships[0] ??
        null;

      if (successor) {
        await tx.project.update({
          where: { id: project.id },
          data:  { ownerId: successor.userId },
        });
        await tx.projectMember.update({
          where: { id: successor.id },
          data:  { accessRole: "OWNER" },
        });
        ownershipTransfers.push({
          projectId:    project.id,
          projectTitle: project.title,
          projectSlug:  project.slug,
          newOwnerId:   successor.userId,
          newOwnerName: successor.user.name,
        });
      } else {
        // Nobody left to run it — close the project with the account.
        await tx.project.update({
          where: { id: project.id },
          data:  { deletedAt: now },
        });
        ownershipTransfers.push({
          projectId:    project.id,
          projectTitle: project.title,
          projectSlug:  project.slug,
          newOwnerId:   null,
          newOwnerName: null,
        });
      }
    }

    // 8. Soft-delete + anonymise the User row.
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

    return { activeMemberships, ownershipTransfers };
  }, {
    // This transaction touches many tables. The client-wide timeout covers
    // most cases; this one gets its own, larger budget to be safe.
    timeout: 120000,
    maxWait: 30000,
  });

  // 9. Tell each affected project who left and why. Recipients are the owner
  //    plus active managers, excluding the deleted account itself.
  await Promise.all(
    memberships.activeMemberships.flatMap((membership) => {
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

  // 10. Tell the successor who inherited the project ownership. Without this
  //    the new owner has no idea they are now responsible for the project.
  await Promise.all(
    memberships.ownershipTransfers
      .filter((transfer) => transfer.newOwnerId)
      .map((transfer) =>
        createNotification({
          userId:     transfer.newOwnerId,
          type:       "MEMBER_JOINED",
          projectId:  transfer.projectId,
          entityType: "project",
          entityId:   transfer.projectId,
          title:      `You are now the owner of ${transfer.projectTitle}`,
          message:    `The previous owner's account was deleted, so you became the owner of ${transfer.projectTitle}.`,
          data: {
            projectId:   transfer.projectId,
            projectSlug: transfer.projectSlug,
            reason:      "ACCOUNT_DELETED",
          },
          dedupeKey: `project-owner-transfer:${transfer.projectId}:${transfer.newOwnerId}`,
        }),
      ),
  );

  // 11. Invalidate the caches that still mention this account or the projects
  //    it owned. Cached project payloads embed the owner id and title.
  await cacheDel(
    CacheKey.projectsMine(userId),
    CacheKey.profile(userId),
    ...memberships.activeMemberships.map((m) => CacheKey.project(m.project.id)),
    ...memberships.ownershipTransfers.map((t) => CacheKey.project(t.projectId)),
  );
  await cacheDelPattern("projects:recommended:*");

  // 12. Best-effort Cloudinary cleanup — runs outside the transaction so a
  //    Cloudinary failure never rolls back the deletion.
  if (existing.avatarUrl) {
    void deleteCloudinaryAsset(existing.avatarUrl);
  }
}
