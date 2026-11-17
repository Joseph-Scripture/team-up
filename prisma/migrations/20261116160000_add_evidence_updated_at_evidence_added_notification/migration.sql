-- Add updatedAt to ProjectEvidence
ALTER TABLE "ProjectEvidence" ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now();

-- Add EVIDENCE_ADDED to NotificationType enum
ALTER TYPE "NotificationType" ADD VALUE 'EVIDENCE_ADDED';
