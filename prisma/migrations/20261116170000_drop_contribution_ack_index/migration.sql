-- The acknowledgement index was created by 20261116130000 to support the
-- two-step confirmation, but no query filters on memberAcknowledgedAt — the
-- column is only read on rows already loaded by id. Drop the unused index so
-- the database matches prisma/schema.prisma exactly.
DROP INDEX "Contribution_memberAcknowledgedAt_idx";
