import prisma from "../db/client.js";

// ─────────────────────────────────────────────────────────────────────────────
// notificationService
//
// Central, fire-and-forget notification writer. Every feature that needs to
// notify a user calls createNotification() here — callers never touch the
// Notification model directly.
//
// Rules:
//  - createNotification() NEVER throws. A notification failure must not break
//    the operation that triggered it.
//  - The dedupeKey unique constraint (userId, dedupeKey) means calling this
//    twice with the same key is a silent no-op at the DB level.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write one notification row.
 *
 * @param {object} opts
 * @param {string}  opts.userId       — recipient's user id
 * @param {string}  opts.type         — NotificationType enum value
 * @param {string}  [opts.projectId]
 * @param {string}  [opts.entityType] — e.g. "invitation", "task", "membership"
 * @param {string}  [opts.entityId]
 * @param {string}  opts.title        — short label shown in the badge
 * @param {string}  opts.message      — one-sentence detail
 * @param {object}  [opts.data]       — arbitrary JSON for frontend deep-linking
 * @param {string}  [opts.dedupeKey]  — duplicate calls with same key are no-ops
 * @returns {Promise<void>}  always resolves, never rejects
 */
export async function createNotification({
  userId,
  type,
  projectId,
  entityType,
  entityId,
  title,
  message,
  data,
  dedupeKey,
}) {
  try {
    await prisma.notification.create({
      data: {
        userId,
        type,
        ...(projectId  && { projectId }),
        ...(entityType && { entityType }),
        ...(entityId   && { entityId }),
        title,
        message,
        ...(data      && { data }),
        ...(dedupeKey && { dedupeKey }),
      },
    });
  } catch (err) {
    // P2002 = unique constraint violation → duplicate notification, ignore silently.
    if (err.code === "P2002") return;
    // All other errors: log but never rethrow — side effects must not kill the
    // main operation that triggered the notification.
    console.error("[notificationService] createNotification failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain-level helpers — one function per event. Call sites in
// invitationService (and future services) stay clean and declarative.
// ─────────────────────────────────────────────────────────────────────────────

/** Notify the invitee that they have received a project invitation. */
export async function notifyInvitationSent({ invitation, project, role, senderName }) {
  await createNotification({
    userId:     invitation.inviteeId,
    type:       "PROJECT_INVITATION",
    projectId:  project.id,
    entityType: "invitation",
    entityId:   invitation.id,
    title:      `You've been invited to join ${project.title}`,
    message:    `${senderName} invited you to the ${role.title} role.`,
    data: {
      invitationId: invitation.id,
      projectSlug:  project.slug,
      roleTitle:    role.title,
    },
    dedupeKey: `invitation-sent:${invitation.id}`,
  });
}

/**
 * Notify the inviter that the invitee responded.
 * @param {string} status  "ACCEPTED" | "DECLINED"
 */
export async function notifyInvitationResponded({ invitation, project, role, inviteeName, status }) {
  const accepted = status === "ACCEPTED";
  await createNotification({
    userId:     invitation.inviterId,
    type:       "INVITATION_RESPONDED",
    projectId:  project.id,
    entityType: "invitation",
    entityId:   invitation.id,
    title:      `${inviteeName} ${accepted ? "accepted" : "declined"} your invitation`,
    message:    accepted
      ? `${inviteeName} joined as ${role.title} on ${project.title}.`
      : `${inviteeName} declined the invitation to ${role.title} on ${project.title}.`,
    data: {
      invitationId: invitation.id,
      projectSlug:  project.slug,
      roleTitle:    role.title,
      response:     status,
    },
    dedupeKey: `invitation-responded:${invitation.id}`,
  });
}

/**
 * Notify the project owner when a new member joins via an accepted invitation.
 * Skipped when the inviter IS the owner (they already get INVITATION_RESPONDED).
 */
export async function notifyMemberJoined({ ownerId, inviterId, project, role, inviteeName, membershipId }) {
  if (ownerId === inviterId) return;
  await createNotification({
    userId:     ownerId,
    type:       "MEMBER_JOINED",
    projectId:  project.id,
    entityType: "membership",
    entityId:   membershipId,
    title:      `${inviteeName} joined ${project.title}`,
    message:    `${inviteeName} accepted an invitation and joined as ${role.title}.`,
    data: {
      projectSlug: project.slug,
      roleTitle:   role.title,
    },
    dedupeKey: `member-joined-invite:${membershipId}`,
  });
}
