-- ─────────────────────────────────────────────────────────────────────────────
-- Add AI-matching fields
--
-- All new columns are nullable (or have defaults) so this migration is fully
-- backward-compatible with existing data. No existing rows are modified.
-- ─────────────────────────────────────────────────────────────────────────────

-- New enums

CREATE TYPE "CollaborationDuration" AS ENUM ('SHORT_TERM', 'LONG_TERM', 'FLEXIBLE');
CREATE TYPE "WorkMode" AS ENUM ('REMOTE', 'HYBRID', 'IN_PERSON');

-- User — new optional matching fields

ALTER TABLE "User"
  ADD COLUMN "professionalRole"      VARCHAR(100),
  ADD COLUMN "collaborationDuration" "CollaborationDuration",
  ADD COLUMN "collaborationGoals"    TEXT[]    NOT NULL DEFAULT '{}',
  ADD COLUMN "projectInterests"      TEXT[]    NOT NULL DEFAULT '{}',
  ADD COLUMN "workMode"              "WorkMode";

-- ProjectMember — away status for inactivity service

ALTER TABLE "ProjectMember"
  ADD COLUMN "awayUntil" TIMESTAMPTZ(3);

-- ProjectRole — new optional matching fields

ALTER TABLE "ProjectRole"
  ADD COLUMN "topics"      TEXT[]      NOT NULL DEFAULT '{}',
  ADD COLUMN "goal"        VARCHAR(200),
  ADD COLUMN "workMode"    "WorkMode",
  ADD COLUMN "targetLevel" "SkillLevel";
