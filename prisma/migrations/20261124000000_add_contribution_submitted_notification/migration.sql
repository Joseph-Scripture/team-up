-- Add CONTRIBUTION_SUBMITTED to NotificationType enum
-- "Please-review" ping sent to the project owner and managers when a
-- contribution is submitted or resubmitted (in-app only).
ALTER TYPE "NotificationType" ADD VALUE 'CONTRIBUTION_SUBMITTED';
