-- AlterTable: add visibility settings to User
-- NULL means "use defaults" (all fields public). When set, it is a JSON object
-- with boolean flags for each controllable field.
ALTER TABLE "User" ADD COLUMN "visibilitySettings" JSONB;

-- AlterTable: add handover note to Task
-- Only written when an owner/manager reassigns the task to a different member.
ALTER TABLE "Task" ADD COLUMN "handoverNote" TEXT;
