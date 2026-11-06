import cron from "node-cron";
import prisma from "../db/client.js";
import { createNotification } from "../services/notificationService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// How many days before the due date a TASK_DEADLINE reminder is sent.
const DEADLINE_WARNING_DAYS = 3;

// Non-terminal statuses — only these tasks are considered for notifications.
const ACTIVE_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"];

// ─────────────────────────────────────────────────────────────────────────────
// sendDeadlineReminders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find tasks due within DEADLINE_WARNING_DAYS and notify once per task per UTC
 * calendar day. The dedupeKey `task-deadline:<taskId>:<date>` prevents duplicate
 * notifications if this job runs more than once on the same day.
 */
async function sendDeadlineReminders() {
  const now     = new Date();
  const cutoff  = new Date(now.getTime() + DEADLINE_WARNING_DAYS * 24 * 60 * 60 * 1000);
  const today   = now.toISOString().slice(0, 10); // YYYY-MM-DD

  const tasks = await prisma.task.findMany({
    where: {
      status:   { in: ACTIVE_STATUSES },
      dueDate:  { gt: now, lte: cutoff },
      assigneeMemberId: { not: null },
      project:  { deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] } },
    },
    select: {
      id: true, title: true, dueDate: true,
      projectId: true,
      project: { select: { title: true } },
      assignee: {
        select: {
          userId: true,
          user:   { select: { name: true } },
        },
      },
    },
  });

  let sent = 0;

  for (const task of tasks) {
    if (!task.assignee?.userId) continue;

    const dueLabel = task.dueDate.toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });

    await createNotification({
      userId:     task.assignee.userId,
      type:       "TASK_DEADLINE",
      projectId:  task.projectId,
      entityType: "task",
      entityId:   task.id,
      title:      `Task due soon: ${task.title}`,
      message:    `"${task.title}" on ${task.project.title} is due on ${dueLabel}.`,
      data: { taskId: task.id, projectId: task.projectId, dueDate: task.dueDate },
      // One reminder per task per day — keyed to today's date so it resends
      // each day the task remains within the warning window.
      dedupeKey: `task-deadline:${task.id}:${today}`,
    });
    sent++;
  }

  if (sent > 0) {
    console.log(`[deadlineNotifier] sent ${sent} deadline reminder(s)`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// sendOverdueAlerts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find tasks that are past their due date and still active.
 * Notifies both the assignee and the project owner.
 * Fires once per day per task — dedupeKey is keyed to today's date.
 */
async function sendOverdueAlerts() {
  const now   = new Date();
  const today = now.toISOString().slice(0, 10);

  const tasks = await prisma.task.findMany({
    where: {
      status:   { in: ACTIVE_STATUSES },
      dueDate:  { lt: now },
      assigneeMemberId: { not: null },
      project:  { deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] } },
    },
    select: {
      id: true, title: true, dueDate: true,
      projectId: true,
      project: {
        select: { title: true, ownerId: true },
      },
      assignee: {
        select: {
          userId: true,
          user:   { select: { name: true } },
        },
      },
    },
  });

  let sent = 0;

  for (const task of tasks) {
    if (!task.assignee?.userId) continue;

    const dueLabel = task.dueDate.toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });

    const overdueByDays = Math.floor(
      (now.getTime() - task.dueDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Notify assignee
    await createNotification({
      userId:     task.assignee.userId,
      type:       "TASK_OVERDUE",
      projectId:  task.projectId,
      entityType: "task",
      entityId:   task.id,
      title:      `Overdue task: ${task.title}`,
      message:    `"${task.title}" was due on ${dueLabel} (${overdueByDays} day${overdueByDays !== 1 ? "s" : ""} ago). Please update its status or mark it blocked.`,
      data: { taskId: task.id, projectId: task.projectId, dueDate: task.dueDate, overdueByDays },
      dedupeKey: `task-overdue:${task.id}:assignee:${today}`,
    });

    // Notify owner (separately — only if they're not the assignee)
    if (task.project.ownerId !== task.assignee.userId) {
      await createNotification({
        userId:     task.project.ownerId,
        type:       "TASK_OVERDUE",
        projectId:  task.projectId,
        entityType: "task",
        entityId:   task.id,
        title:      `Overdue task on ${task.project.title}: ${task.title}`,
        message:    `"${task.title}" assigned to ${task.assignee.user.name} is ${overdueByDays} day${overdueByDays !== 1 ? "s" : ""} overdue.`,
        data: { taskId: task.id, projectId: task.projectId, dueDate: task.dueDate, overdueByDays },
        dedupeKey: `task-overdue:${task.id}:owner:${today}`,
      });
    }

    sent++;
  }

  if (sent > 0) {
    console.log(`[deadlineNotifier] sent overdue alerts for ${sent} task(s)`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// startDeadlineNotifier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register both cron jobs.
 *
 * Schedule:
 *   - Deadline reminders: every day at 08:00 UTC
 *   - Overdue alerts:     every day at 09:00 UTC
 *
 * Both jobs are timezone-aware and skip silently when the DB has no matches,
 * so they are safe to run on every server instance.
 */
export function startDeadlineNotifier() {
  // Daily at 08:00 UTC — deadline reminders (tasks due within 3 days)
  cron.schedule("0 8 * * *", async () => {
    console.log("[deadlineNotifier] running deadline reminder job");
    try {
      await sendDeadlineReminders();
    } catch (err) {
      console.error("[deadlineNotifier] deadline reminder job failed:", err.message);
    }
  }, { timezone: "UTC" });

  // Daily at 09:00 UTC — overdue alerts (tasks past due date)
  cron.schedule("0 9 * * *", async () => {
    console.log("[deadlineNotifier] running overdue alert job");
    try {
      await sendOverdueAlerts();
    } catch (err) {
      console.error("[deadlineNotifier] overdue alert job failed:", err.message);
    }
  }, { timezone: "UTC" });

  console.log("[deadlineNotifier] scheduler started (deadline: 08:00 UTC, overdue: 09:00 UTC)");
}
