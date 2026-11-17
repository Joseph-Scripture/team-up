-- The final outcome the project owner writes when completing the project.
-- Kept separate from `outcome`, which is the expected outcome captured in the
-- project wizard.
ALTER TABLE "Project" ADD COLUMN "completionOutcome" TEXT;
