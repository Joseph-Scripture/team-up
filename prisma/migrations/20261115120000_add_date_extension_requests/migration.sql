-- ─────────────────────────────────────────────────────────────────────────────
-- Add date extension requests
--
-- A project member can request more time for a task deadline or for the
-- project's target end date. A project owner/manager accepts or declines the
-- request (optionally with a decision note), and the requester is notified.
-- ─────────────────────────────────────────────────────────────────────────────

-- New notification types for the request/reply lifecycle.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DATE_EXTENSION_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DATE_EXTENSION_DECIDED';

CREATE TABLE "DateExtensionRequest" (
  "id"            TEXT NOT NULL,
  "projectId"     TEXT NOT NULL,
  -- Null means the request targets Project.targetEndDate.
  "taskId"        TEXT,
  "requesterId"   TEXT NOT NULL,
  "reviewerId"    TEXT,
  -- Snapshot of the deadline when the request was submitted.
  "currentDate"   TIMESTAMP(3) WITH TIME ZONE,
  "requestedDate" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "reason"        TEXT NOT NULL,
  "decisionNote"  TEXT,
  "status"        "RequestStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt"     TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "reviewedAt"    TIMESTAMP(3) WITH TIME ZONE,

  CONSTRAINT "DateExtensionRequest_pkey" PRIMARY KEY ("id")
);

-- One PENDING request per (project, requester, target). COALESCE makes
-- project-level requests (taskId = NULL) participate in the same invariant.
CREATE UNIQUE INDEX IF NOT EXISTS "DateExtensionRequest_one_pending_uq"
  ON "DateExtensionRequest" ("projectId", "requesterId", COALESCE("taskId", ''))
  WHERE "status" = 'PENDING';

CREATE INDEX "DateExtensionRequest_projectId_status_idx"
  ON "DateExtensionRequest" ("projectId", "status");

CREATE INDEX "DateExtensionRequest_requesterId_status_idx"
  ON "DateExtensionRequest" ("requesterId", "status");

CREATE INDEX "DateExtensionRequest_taskId_status_idx"
  ON "DateExtensionRequest" ("taskId", "status");

CREATE INDEX "DateExtensionRequest_reviewedAt_idx"
  ON "DateExtensionRequest" ("reviewedAt");

ALTER TABLE "DateExtensionRequest"
  ADD CONSTRAINT "DateExtensionRequest_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Composite FK: the task must belong to the same project.
ALTER TABLE "DateExtensionRequest"
  ADD CONSTRAINT "DateExtensionRequest_projectId_taskId_fkey"
  FOREIGN KEY ("projectId", "taskId") REFERENCES "Task"("projectId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DateExtensionRequest"
  ADD CONSTRAINT "DateExtensionRequest_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DateExtensionRequest"
  ADD CONSTRAINT "DateExtensionRequest_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
