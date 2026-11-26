-- One contribution summary per member per project.
--
-- 1. Completed tasks become TASK_COMPLETION evidence entries inside the
--    member's summary (ContributionEvidence.taskId) instead of spawning a
--    separate Contribution row with its own review cycle.
-- 2. Existing duplicate contributions are merged into a single summary per
--    (projectId, memberId) BEFORE the unique constraint is created. All
--    evidence and the full review history are re-parented to the kept row.

-- 1. New evidence type for completed-task entries
ALTER TYPE "EvidenceType" ADD VALUE 'TASK_COMPLETION';

-- 2a. Pick the keeper per member: a CONFIRMED row if one exists (so merging
--     never downgrades confirmed work), otherwise the newest row.
--     Re-parent every surplus row's evidence onto the keeper.
WITH ranked AS (
  SELECT "id", "projectId", "memberId",
         ROW_NUMBER() OVER (
           PARTITION BY "projectId", "memberId"
           ORDER BY ("status" = 'CONFIRMED') DESC,
                    "confirmedAt" DESC NULLS LAST,
                    "submittedAt" DESC,
                    "createdAt" DESC
         ) AS rn
  FROM "Contribution"
)
UPDATE "ContributionEvidence" e
SET "contributionId" = k."id"
FROM ranked k
JOIN "Contribution" s
  ON s."projectId" = k."projectId" AND s."memberId" = k."memberId"
WHERE k.rn = 1
  AND s."id" <> k."id"
  AND e."contributionId" = s."id";

-- 2b. Same for the append-only review history (nothing is discarded).
WITH ranked AS (
  SELECT "id", "projectId", "memberId",
         ROW_NUMBER() OVER (
           PARTITION BY "projectId", "memberId"
           ORDER BY ("status" = 'CONFIRMED') DESC,
                    "confirmedAt" DESC NULLS LAST,
                    "submittedAt" DESC,
                    "createdAt" DESC
         ) AS rn
  FROM "Contribution"
)
UPDATE "ContributionReview" r
SET "contributionId" = k."id"
FROM ranked k
JOIN "Contribution" s
  ON s."projectId" = k."projectId" AND s."memberId" = k."memberId"
WHERE k.rn = 1
  AND s."id" <> k."id"
  AND r."contributionId" = s."id";

-- 2c. Delete the surplus rows now that everything valuable was moved off them.
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "projectId", "memberId"
           ORDER BY ("status" = 'CONFIRMED') DESC,
                    "confirmedAt" DESC NULLS LAST,
                    "submittedAt" DESC,
                    "createdAt" DESC
         ) AS rn
  FROM "Contribution"
)
DELETE FROM "Contribution" c
USING ranked r
WHERE c."id" = r."id" AND r.rn > 1;

-- 2d. The invariant itself: one summary per member per project.
CREATE UNIQUE INDEX "Contribution_projectId_memberId_key"
  ON "Contribution"("projectId", "memberId");

-- 3. The summary is no longer task-scoped — task history lives on the
--    evidence entries (added below).
ALTER TABLE "Contribution" DROP CONSTRAINT "Contribution_projectId_taskId_fkey";
DROP INDEX "Contribution_taskId_idx";
ALTER TABLE "Contribution" DROP COLUMN "taskId";

-- 4. Evidence entries can now point at the completed task they document.
--    url becomes nullable: a TASK_COMPLETION entry has no URL of its own.
ALTER TABLE "ContributionEvidence" ALTER COLUMN "url" DROP NOT NULL;
ALTER TABLE "ContributionEvidence" ADD COLUMN "taskId" TEXT;
ALTER TABLE "ContributionEvidence"
  ADD CONSTRAINT "ContributionEvidence_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ContributionEvidence_taskId_idx" ON "ContributionEvidence"("taskId");
