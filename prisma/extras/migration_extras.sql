-- =====================================================================
-- Teamup — migration extras (PostgreSQL)
--
-- Objects Prisma cannot express in PSL: partial unique indexes, CHECK
-- constraints, expression/GIN indexes.
--
-- HOW THIS FITS TOGETHER (drift guard):
--   * These objects are physically part of migration history (appended
--     to prisma/migrations/20261013092151_teamup_v2/migration.sql), so
--     every replay — shadow DB during `migrate dev`, `migrate deploy`
--     on a fresh database — recreates them. That is why the database
--     never drifts from migration history.
--   * Objects that Prisma CAN express (plain-column GIN trigram indexes)
--     are declared in schema.prisma instead and managed by Prisma.
--   * This file is kept 100% idempotent (IF NOT EXISTS guards) so it
--     can repair a database at any time:  npm run db:extras
--   * verify_extras.sql asserts every object below exists:
--     npm run db:verify-extras  (wired into migrate:dev / migrate:deploy,
--     so a Prisma upgrade or an accidental `db push` cannot silently
--     strip the hardening — the command fails loudly instead).
--
-- ADDING A NEW EXTRA:
--   1. Is it expressible in schema.prisma (plain index/unique)? Declare
--      it there and you are done.
--   2. Otherwise add it here (idempotently), append it to a new
--      migration (`npx prisma migrate dev --create-only`, edit
--      migration.sql, then `npx prisma migrate dev`), and add it to
--      verify_extras.sql.
--
-- NEVER run `prisma db push` against a database that must keep these
-- objects: db push syncs to schema.prisma exactly and drops everything
-- it does not know about.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Extensions (needed by the GIN indexes below)
-- ---------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- 1. Partial unique indexes — "at most one X while in state Y"
--    Postgres treats NULLs as distinct, which is exactly the semantics
--    these partial indexes encode.
-- ---------------------------------------------------------------------

-- One ACTIVE membership per (project, user). History rows (LEFT/RELEASED)
-- are unlimited, so a user can leave and rejoin.
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectMember_one_active_per_user_uq"
  ON "ProjectMember" ("projectId", "userId")
  WHERE "status" = 'ACTIVE';

-- Exactly one ACTIVE owner row per project.
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectMember_one_active_owner_uq"
  ON "ProjectMember" ("projectId")
  WHERE "accessRole" = 'OWNER' AND "status" = 'ACTIVE';

-- One PENDING join request per (project, requester); re-applying after a
-- decline is allowed.
CREATE UNIQUE INDEX IF NOT EXISTS "JoinRequest_one_pending_uq"
  ON "JoinRequest" ("projectId", "requesterId")
  WHERE "status" = 'PENDING';

-- One PENDING invitation per (project, invitee).
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectInvitation_one_pending_uq"
  ON "ProjectInvitation" ("projectId", "inviteeId")
  WHERE "status" = 'PENDING';

-- ---------------------------------------------------------------------
-- 2. CHECK constraints — cheap, always-on data integrity.
--    Postgres has no ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS, so
--    each one is guarded through pg_constraint.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_email_lowercase_chk') THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_email_lowercase_chk" CHECK ("email" = lower("email"));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_weeklyAvailability_chk') THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_weeklyAvailability_chk"
        CHECK ("weeklyAvailabilityHours" IS NULL OR "weeklyAvailabilityHours" BETWEEN 0 AND 168);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Project_durationWeeks_chk') THEN
    ALTER TABLE "Project"
      ADD CONSTRAINT "Project_durationWeeks_chk" CHECK ("durationWeeks" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Project_weeklyHours_chk') THEN
    ALTER TABLE "Project"
      ADD CONSTRAINT "Project_weeklyHours_chk" CHECK ("weeklyHours" BETWEEN 1 AND 168);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Project_dates_chk') THEN
    ALTER TABLE "Project"
      ADD CONSTRAINT "Project_dates_chk"
        CHECK ("startDate" IS NULL OR "targetEndDate" IS NULL OR "targetEndDate" >= "startDate");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Project_endedReason_chk') THEN
    ALTER TABLE "Project"
      ADD CONSTRAINT "Project_endedReason_chk"
        CHECK ("status" <> 'ENDED_EARLY' OR "endedReason" IS NOT NULL);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectRole_requiredMembers_chk') THEN
    ALTER TABLE "ProjectRole"
      ADD CONSTRAINT "ProjectRole_requiredMembers_chk" CHECK ("requiredMembers" >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectRole_hoursPerWeek_chk') THEN
    ALTER TABLE "ProjectRole"
      ADD CONSTRAINT "ProjectRole_hoursPerWeek_chk"
        CHECK ("hoursPerWeek" IS NULL OR "hoursPerWeek" BETWEEN 1 AND 168);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Project_teamSize_chk') THEN
    ALTER TABLE "Project"
      ADD CONSTRAINT "Project_teamSize_chk"
        CHECK ("teamSize" IS NULL OR "teamSize" >= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectMember_hours_chk') THEN
    ALTER TABLE "ProjectMember"
      ADD CONSTRAINT "ProjectMember_hours_chk"
        CHECK ("committedHoursPerWeek" IS NULL OR "committedHoursPerWeek" BETWEEN 1 AND 168);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectMember_endedAt_chk') THEN
    ALTER TABLE "ProjectMember"
      ADD CONSTRAINT "ProjectMember_endedAt_chk"
        CHECK (("status" = 'ACTIVE' AND "endedAt" IS NULL) OR ("status" <> 'ACTIVE' AND "endedAt" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectMember_dates_chk') THEN
    ALTER TABLE "ProjectMember"
      ADD CONSTRAINT "ProjectMember_dates_chk"
        CHECK ("endedAt" IS NULL OR "endedAt" >= "joinedAt");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JoinRequest_hours_chk') THEN
    ALTER TABLE "JoinRequest"
      ADD CONSTRAINT "JoinRequest_hours_chk"
        CHECK ("proposedHoursPerWeek" IS NULL OR "proposedHoursPerWeek" BETWEEN 1 AND 168);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectInvitation_hours_chk') THEN
    ALTER TABLE "ProjectInvitation"
      ADD CONSTRAINT "ProjectInvitation_hours_chk"
        CHECK ("proposedHoursPerWeek" IS NULL OR "proposedHoursPerWeek" BETWEEN 1 AND 168);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Task_estimatedHours_chk') THEN
    ALTER TABLE "Task"
      ADD CONSTRAINT "Task_estimatedHours_chk"
        CHECK ("estimatedHours" IS NULL OR "estimatedHours" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Task_completedAt_chk') THEN
    ALTER TABLE "Task"
      ADD CONSTRAINT "Task_completedAt_chk"
        CHECK ("status" <> 'COMPLETED' OR "completedAt" IS NOT NULL);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Contribution_confirmedAt_chk') THEN
    ALTER TABLE "Contribution"
      ADD CONSTRAINT "Contribution_confirmedAt_chk"
        CHECK (("status" = 'CONFIRMED') = ("confirmedAt" IS NOT NULL));
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. Search indexes that cannot be declared in schema.prisma
--    (expression / partial GIN indexes).
--    The plain-column trigram indexes "Project_title_trgm" and
--    "Skill_name_trgm" are declared in schema.prisma and are therefore
--    NOT repeated here.
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "Project_search_gin"
  ON "Project" USING GIN (to_tsvector('simple', "title" || ' ' || "description"))
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "User_name_trgm"
  ON "User" USING GIN ("name" gin_trgm_ops) WHERE "deletedAt" IS NULL;

-- ---------------------------------------------------------------------
-- 4. Partial indexes for hot paths and background jobs
-- ---------------------------------------------------------------------

-- Unread-notification badge / list.
CREATE INDEX IF NOT EXISTS "Notification_unread_idx"
  ON "Notification" ("userId", "createdAt" DESC)
  WHERE "readAt" IS NULL;

-- Deadline / overdue scanner only needs open tasks that have a due date.
CREATE INDEX IF NOT EXISTS "Task_open_due_idx"
  ON "Task" ("dueDate")
  WHERE "dueDate" IS NOT NULL AND "status" NOT IN ('COMPLETED', 'CANCELLED');

-- Marketplace listing: open, not-deleted projects, newest first.
CREATE INDEX IF NOT EXISTS "Project_listing_idx"
  ON "Project" ("publishedAt" DESC)
  WHERE "status" = 'OPEN' AND "deletedAt" IS NULL;

-- Housekeeping: expiring sessions / tokens / invitations.
CREATE INDEX IF NOT EXISTS "Session_active_idx"
  ON "Session" ("expiresAt")
  WHERE "revokedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "ProjectInvitation_expiring_idx"
  ON "ProjectInvitation" ("expiresAt")
  WHERE "status" = 'PENDING' AND "expiresAt" IS NOT NULL;
