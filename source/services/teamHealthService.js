import prisma from "../db/client.js";
import config from "../../config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Team health
//
// ONE status for the whole team — never a score for an individual.
//
//   ON_TRACK         nothing is wrong
//   NEEDS_ATTENTION  an overdue task, a blocked task, a task waiting too long
//                    for review, or a missed check-in
//   AT_RISK          an overdue milestone, or a member flagged as inactive
//
// When more than one condition applies the most serious one wins:
//   AT_RISK > NEEDS_ATTENTION > ON_TRACK
// ─────────────────────────────────────────────────────────────────────────────

export const TeamHealthStatus = {
  ON_TRACK:        "ON_TRACK",
  NEEDS_ATTENTION: "NEEDS_ATTENTION",
  AT_RISK:         "AT_RISK",
};

// A member is considered inactive after this many days without any activity.
// Configurable through TEAM_HEALTH_INACTIVITY_DAYS (default 14).
const INACTIVITY_DAYS = config.TEAM_HEALTH_INACTIVITY_DAYS;

// A weekly check-in is expected. A window that closes without a reply in the
// updates thread counts as a missed check-in.
// Configurable through TEAM_HEALTH_CHECK_IN_INTERVAL_DAYS (default 7).
const CHECK_IN_INTERVAL_DAYS = config.TEAM_HEALTH_CHECK_IN_INTERVAL_DAYS;

// A task that has been sitting IN_REVIEW for this many days is stuck: nobody
// confirmed the work, so the task cannot move forward. Configurable through
// TEAM_HEALTH_REVIEW_STALE_DAYS (default 3).
const REVIEW_STALE_DAYS = config.TEAM_HEALTH_REVIEW_STALE_DAYS;

// Only running projects can be unhealthy.
const HEALTHY_PROJECT_STATUSES = ["OPEN", "IN_PROGRESS"];

// Tasks that still count as work in progress.
const OPEN_TASK_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"];

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(date, now) {
  return (now.getTime() - new Date(date).getTime()) / DAY_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// getTeamHealthForProjects
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the team health for a batch of projects.
 *
 * All signals are read in four batched queries, so the cost stays flat no
 * matter how many projects are asked for.
 *
 * @param {object[]} projects — each { id, status, startDate, createdAt }
 * @param {Date}   [now]
 * @returns {Map<string, object>} projectId → health payload
 */
export async function getTeamHealthForProjects(projects, { now = new Date() } = {}) {
  const result = new Map();
  if (!projects || projects.length === 0) return result;

  const tracked = projects.filter((p) => HEALTHY_PROJECT_STATUSES.includes(p.status));
  for (const project of projects) {
    if (!HEALTHY_PROJECT_STATUSES.includes(project.status)) {
      result.set(project.id, {
        status:  TeamHealthStatus.ON_TRACK,
        reasons: [],
        signals: publicSignals(emptySignals()),
      });
    }
  }
  if (tracked.length === 0) return result;

  const ids = tracked.map((p) => p.id);

  // Active memberships — the member roster, the inactivity rule and the
  // check-in rule (a check-in only makes sense for a team).
  const membershipRows = await prisma.projectMember.findMany({
    where: { projectId: { in: ids }, status: "ACTIVE" },
    select: {
      projectId: true, userId: true, joinedAt: true, awayUntil: true,
      user: { select: { name: true } },
    },
  });

  const membersByProject = new Map(ids.map((id) => [id, []]));
  for (const row of membershipRows) {
    membersByProject.get(row.projectId)?.push(row);
  }

  // Everything a member could do is "activity": moving a task, posting an
  // update, commenting. Anything older than the inactivity window cannot
  // change the outcome, so the task query is bounded.
  const activityCutoff = new Date(now.getTime() - (INACTIVITY_DAYS + 1) * DAY_MS);

  const [tasks, milestones, updateGroups, comments] = await Promise.all([
    prisma.task.findMany({
      where: {
        projectId: { in: ids },
        OR: [
          { status: { in: OPEN_TASK_STATUSES } },
          { updatedAt: { gte: activityCutoff } },
        ],
      },
      select: {
        projectId: true, status: true, dueDate: true,
        updatedAt: true,
        assignee: { select: { userId: true } },
      },
    }),

    prisma.milestone.findMany({
      where: {
        projectId: { in: ids },
        status: { not: "COMPLETED" },
        dueDate: { not: null },
      },
      select: { projectId: true, title: true, dueDate: true },
    }),

    // One row per (project, author) with the author's latest update — the
    // project maximum is derived from these rows in memory.
    prisma.teamUpdate.groupBy({
      by: ["projectId", "authorId"],
      where: { projectId: { in: ids } },
      _max: { createdAt: true },
    }),

    prisma.taskComment.findMany({
      where: {
        createdAt: { gte: activityCutoff },
        task: { projectId: { in: ids } },
      },
      select: {
        authorId: true, createdAt: true,
        task: { select: { projectId: true } },
      },
    }),
  ]);

  // ── Fold the raw rows into per-project signals ────────────────────────────
  const signalsByProject = new Map(ids.map((id) => [id, emptySignals()]));

  for (const task of tasks) {
    const signals = signalsByProject.get(task.projectId);
    if (!signals) continue;

    if (task.status === "BLOCKED") {
      signals.blockedTasks += 1;
    }
    if (
      task.status === "IN_REVIEW" &&
      task.updatedAt &&
      daysAgo(task.updatedAt, now) >= REVIEW_STALE_DAYS
    ) {
      signals.tasksAwaitingReview += 1;
    }
    if (
      OPEN_TASK_STATUSES.includes(task.status) &&
      task.dueDate &&
      new Date(task.dueDate) < now
    ) {
      signals.overdueTasks += 1;
    }

    // Task activity counts for the assignee.
    const userId = task.assignee?.userId;
    if (userId) {
      touchActivity(signals, userId, task.updatedAt);
    }
  }

  for (const milestone of milestones) {
    const signals = signalsByProject.get(milestone.projectId);
    if (!signals) continue;
    if (new Date(milestone.dueDate) < now) {
      signals.overdueMilestones += 1;
      signals.overdueMilestoneTitles.push(milestone.title);
    }
  }

  for (const group of updateGroups) {
    const signals = signalsByProject.get(group.projectId);
    if (!signals) continue;
    const last = group._max.createdAt;
    if (!last) continue;

    if (!signals.lastUpdateAt || new Date(last) > new Date(signals.lastUpdateAt)) {
      signals.lastUpdateAt = last;
    }
    touchActivity(signals, group.authorId, last);
  }

  for (const comment of comments) {
    const signals = signalsByProject.get(comment.task?.projectId);
    if (!signals) continue;
    touchActivity(signals, comment.authorId, comment.createdAt);
  }

  // ── Turn the signals into a status ───────────────────────────────────────
  for (const project of tracked) {
    const signals = signalsByProject.get(project.id);
    const members = membersByProject.get(project.id) ?? [];
    result.set(project.id, computeHealth({ ...project, memberships: members }, signals, now));
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// getProjectTeamHealth
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Team health of a single project.
 *
 * Returns null when the requester is not part of the team — the health of a
 * team is private to that team. Callers translate that null into an HTTP 404
 * (see projectController.GetProjectHealth) instead of exposing a distinct
 * "not allowed" status, so a non-member cannot tell a project whose health
 * they may not see from a project that does not exist.
 *
 * @param {string} projectId
 * @param {string} requesterId
 * @returns {Promise<object|null>} health payload, or null for non-members
 */
export async function getProjectTeamHealth(projectId, requesterId) {
  if (!projectId || !requesterId) return null;

  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true, title: true, status: true, ownerId: true,
      startDate: true, createdAt: true,
      memberships: {
        where: { status: "ACTIVE" },
        select: { userId: true },
      },
    },
  });

  if (!project) return null;

  const isMember = project.memberships.some((m) => m.userId === requesterId);
  if (!isMember && project.ownerId !== requesterId) return null;

  const map = await getTeamHealthForProjects([project]);
  return map.get(projectId) ?? {
    status:  TeamHealthStatus.ON_TRACK,
    reasons: [],
    signals: publicSignals(emptySignals()),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function emptySignals() {
  return {
    overdueTasks: 0,
    blockedTasks: 0,
    tasksAwaitingReview: 0,
    overdueMilestones: 0,
    overdueMilestoneTitles: [],
    lastUpdateAt: null,
    inactiveMembers: [],
    activityByUser: {},
  };
}

function touchActivity(signals, userId, at) {
  if (!userId || !at) return;
  const current = signals.activityByUser[userId];
  if (!current || new Date(at) > new Date(current)) {
    signals.activityByUser[userId] = at;
  }
}

/**
 * Turn the raw signals of one project into { status, reasons, signals }.
 */
function computeHealth(project, signals, now) {
  const reasons = [];
  const activeMembers = project.memberships ?? [];

  // ── AT RISK ───────────────────────────────────────────────────────────────
  if (signals.overdueMilestones > 0) {
    reasons.push({
      code:    "OVERDUE_MILESTONE",
      level:   TeamHealthStatus.AT_RISK,
      message: signals.overdueMilestones === 1
        ? `Milestone "${signals.overdueMilestoneTitles[0]}" is overdue.`
        : `${signals.overdueMilestones} milestones are overdue.`,
    });
  }

  const inactiveMembers = findInactiveMembers(activeMembers, signals, now);
  signals.inactiveMembers = inactiveMembers.map((m) => m.userId);

  for (const member of inactiveMembers) {
    reasons.push({
      code:    "INACTIVE_MEMBER",
      level:   TeamHealthStatus.AT_RISK,
      userId:  member.userId,
      message: `${member.name ?? "A member"} has been inactive for more than ${INACTIVITY_DAYS} days.`,
    });
  }

  if (reasons.length > 0) {
    return {
      status:  TeamHealthStatus.AT_RISK,
      reasons,
      signals: publicSignals(signals),
    };
  }

  // ── NEEDS ATTENTION ───────────────────────────────────────────────────────
  if (signals.overdueTasks > 0) {
    reasons.push({
      code:    "OVERDUE_TASK",
      level:   TeamHealthStatus.NEEDS_ATTENTION,
      message: signals.overdueTasks === 1
        ? "1 task is overdue."
        : `${signals.overdueTasks} tasks are overdue.`,
    });
  }

  if (signals.blockedTasks > 0) {
    reasons.push({
      code:    "BLOCKED_TASK",
      level:   TeamHealthStatus.NEEDS_ATTENTION,
      message: signals.blockedTasks === 1
        ? "1 task is blocked."
        : `${signals.blockedTasks} tasks are blocked.`,
    });
  }

  if (signals.tasksAwaitingReview > 0) {
    reasons.push({
      code:    "TASK_AWAITING_REVIEW",
      level:   TeamHealthStatus.NEEDS_ATTENTION,
      message: signals.tasksAwaitingReview === 1
        ? `1 task has been waiting for review for more than ${REVIEW_STALE_DAYS} days.`
        : `${signals.tasksAwaitingReview} tasks have been waiting for review for more than ${REVIEW_STALE_DAYS} days.`,
    });
  }

  const missedCheckIn = hasMissedCheckIn(project, signals, now);
  if (missedCheckIn) {
    reasons.push({
      code:    "MISSED_CHECK_IN",
      level:   TeamHealthStatus.NEEDS_ATTENTION,
      message: signals.lastUpdateAt
        ? `No team update since ${new Date(signals.lastUpdateAt).toISOString().slice(0, 10)}.`
        : "No team update has been posted yet.",
    });
  }

  if (reasons.length > 0) {
    return {
      status:  TeamHealthStatus.NEEDS_ATTENTION,
      reasons,
      signals: publicSignals(signals),
    };
  }

  return {
    status:  TeamHealthStatus.ON_TRACK,
    reasons: [],
    signals: publicSignals(signals),
  };
}

/**
 * A member is inactive when they joined at least INACTIVITY_DAYS ago and have
 * not done anything since. Members who marked themselves as away are not
 * flagged.
 */
function findInactiveMembers(members, signals, now) {
  const cutoff = new Date(now.getTime() - INACTIVITY_DAYS * DAY_MS);
  const inactive = [];

  for (const member of members) {
    // Deliberately away — never flag them.
    if (member.awayUntil && new Date(member.awayUntil) >= now) continue;

    const joinedAt = member.joinedAt ? new Date(member.joinedAt) : null;
    if (!joinedAt || joinedAt > cutoff) continue;

    const lastActivity = signals.activityByUser[member.userId]
      ? new Date(signals.activityByUser[member.userId])
      : joinedAt;
    if (lastActivity > cutoff) continue;

    inactive.push({ userId: member.userId, name: member.user?.name ?? member.name ?? null });
  }

  return inactive;
}

/**
 * A weekly check-in is expected. A window that closes without anybody replying
 * in the updates thread counts as missed.
 *
 * A check-in only makes sense for a team, so projects with a single active
 * member are never flagged for it.
 */
function hasMissedCheckIn(project, signals, now) {
  const activeMembers = project.memberships ?? [];
  if (activeMembers.length < 2) return false;

  const anchor = project.startDate
    ? new Date(project.startDate)
    : activeMembers.reduce((earliest, m) => {
        const joined = m.joinedAt ? new Date(m.joinedAt) : null;
        if (!joined) return earliest;
        return !earliest || joined < earliest ? joined : earliest;
      }, null) ?? new Date(project.createdAt);

  const lastReply = signals.lastUpdateAt ? new Date(signals.lastUpdateAt) : anchor;

  return daysAgo(lastReply, now) >= CHECK_IN_INTERVAL_DAYS;
}

/**
 * Strip the internal bookkeeping from the signals before sending them out.
 */
function publicSignals(signals) {
  return {
    overdueTasks:         signals.overdueTasks,
    blockedTasks:         signals.blockedTasks,
    tasksAwaitingReview:  signals.tasksAwaitingReview,
    overdueMilestones:    signals.overdueMilestones,
    inactiveMembers:      signals.inactiveMembers,
    lastUpdateAt:         signals.lastUpdateAt,
    checkInIntervalDays:  CHECK_IN_INTERVAL_DAYS,
    inactivityDays:       INACTIVITY_DAYS,
    reviewStaleDays:      REVIEW_STALE_DAYS,
  };
}
