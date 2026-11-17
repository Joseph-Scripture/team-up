-- Project page visibility: private to the team until the project is shared.
-- Publishing a draft sets isShared = true (done by the service layer).
-- Existing published projects are shared so the migration does not hide them.
ALTER TABLE "Project" ADD COLUMN "isShared" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Project"
SET "isShared" = true
WHERE "status" <> 'DRAFT' AND "deletedAt" IS NULL;
