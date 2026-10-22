-- =====================================================================
-- Teamup — extras verification (drift guard)
--
-- Asserts that every object contributed by migration_extras.sql (plus
-- the Prisma-managed trigram indexes) exists in the public schema.
-- Fails with a non-zero exit code and a list of what is missing, so it
-- can gate `migrate dev` / `migrate deploy` in npm scripts and CI.
--
--   npm run db:verify-extras
--
-- If something is missing, repair with:
--   npm run db:extras
-- =====================================================================

DO $$
DECLARE
  missing text := '';
  idx     text;
  chk     text;
BEGIN
  -- Indexes (partial unique, partial GIN, trigram; checked by name).
  FOREACH idx IN ARRAY ARRAY[
    -- Partial unique invariants (migration_extras.sql)
    'ProjectMember_one_active_per_user_uq',
    'ProjectMember_one_active_owner_uq',
    'JoinRequest_one_pending_uq',
    'ProjectInvitation_one_pending_uq',
    -- Search / hot-path indexes (migration_extras.sql)
    'Project_search_gin',
    'User_name_trgm',
    'Notification_unread_idx',
    'Task_open_due_idx',
    'Project_listing_idx',
    'Session_active_idx',
    'ProjectInvitation_expiring_idx',
    -- Trigram indexes declared in schema.prisma (Prisma-managed)
    'Project_title_trgm',
    'Skill_name_trgm'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = idx
    ) THEN
      missing := missing || '  missing index: ' || idx || E'\n';
    END IF;
  END LOOP;

  -- CHECK constraints (migration_extras.sql).
  FOREACH chk IN ARRAY ARRAY[
    'User_email_lowercase_chk',
    'User_weeklyAvailability_chk',
    'Project_durationWeeks_chk',
    'Project_weeklyHours_chk',
    'Project_dates_chk',
    'Project_endedReason_chk',
    'ProjectRole_requiredMembers_chk',
    'ProjectRole_hoursPerWeek_chk',
    'Project_teamSize_chk',
    'ProjectMember_hours_chk',
    'ProjectMember_endedAt_chk',
    'ProjectMember_dates_chk',
    'JoinRequest_hours_chk',
    'ProjectInvitation_hours_chk',
    'Task_estimatedHours_chk',
    'Task_completedAt_chk',
    'Contribution_confirmedAt_chk'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = chk AND contype = 'c'
    ) THEN
      missing := missing || '  missing CHECK constraint: ' || chk || E'\n';
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    missing := missing || '  missing extension: pg_trgm' || E'\n';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION E'Database hardening is incomplete. Missing objects:\n%',
      missing
      USING HINT = 'Repair with: npm run db:extras';
  END IF;

  RAISE NOTICE 'verify_extras: OK — all hardened objects are present.';
END $$;
