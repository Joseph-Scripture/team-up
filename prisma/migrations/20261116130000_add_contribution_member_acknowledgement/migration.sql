-- Two-step contribution confirmation: the contributor reviews their own summary
-- (memberAcknowledgedAt) before a teammate is allowed to confirm it.
ALTER TABLE "Contribution" ADD COLUMN "memberAcknowledgedAt" TIMESTAMPTZ(3);

-- Contributions confirmed before this change are treated as acknowledged —
-- the teammate already reviewed them.
UPDATE "Contribution"
SET "memberAcknowledgedAt" = "confirmedAt"
WHERE "status" = 'CONFIRMED' AND "memberAcknowledgedAt" IS NULL;

CREATE INDEX "Contribution_memberAcknowledgedAt_idx" ON "Contribution"("memberAcknowledgedAt");
