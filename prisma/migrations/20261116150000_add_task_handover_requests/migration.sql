-- Task handover requests.
--
-- "Hand it over" from the overdue prompt only sends a REQUEST — it never
-- changes the task owner. Only the project owner does that, by reassigning
-- the task manually.

-- New enum values for the handover notifications.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_HANDOVER_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_HANDOVER_DECIDED';

-- New enum for the request life cycle.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HandoverRequestStatus') THEN
    CREATE TYPE "HandoverRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "TaskHandoverRequest" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "requesterMemberId" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "status" "HandoverRequestStatus" NOT NULL DEFAULT 'PENDING',
  "note" TEXT,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "TaskHandoverRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TaskHandoverRequest_projectId_status_idx" ON "TaskHandoverRequest"("projectId", "status");
CREATE INDEX IF NOT EXISTS "TaskHandoverRequest_taskId_idx" ON "TaskHandoverRequest"("taskId");
CREATE INDEX IF NOT EXISTS "TaskHandoverRequest_requesterId_status_idx" ON "TaskHandoverRequest"("requesterId", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskHandoverRequest_projectId_fkey') THEN
    ALTER TABLE "TaskHandoverRequest" ADD CONSTRAINT "TaskHandoverRequest_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskHandoverRequest_taskId_fkey') THEN
    ALTER TABLE "TaskHandoverRequest" ADD CONSTRAINT "TaskHandoverRequest_taskId_fkey"
      FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskHandoverRequest_requesterMemberId_fkey') THEN
    ALTER TABLE "TaskHandoverRequest" ADD CONSTRAINT "TaskHandoverRequest_requesterMemberId_fkey"
      FOREIGN KEY ("requesterMemberId") REFERENCES "ProjectMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskHandoverRequest_requesterId_fkey') THEN
    ALTER TABLE "TaskHandoverRequest" ADD CONSTRAINT "TaskHandoverRequest_requesterId_fkey"
      FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskHandoverRequest_decidedById_fkey') THEN
    ALTER TABLE "TaskHandoverRequest" ADD CONSTRAINT "TaskHandoverRequest_decidedById_fkey"
      FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Only one PENDING handover request per task.
CREATE UNIQUE INDEX IF NOT EXISTS "TaskHandoverRequest_one_pending_uq"
  ON "TaskHandoverRequest" ("taskId")
  WHERE "status" = 'PENDING';
