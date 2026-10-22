-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('WEB_APPLICATION', 'MOBILE_APP', 'DESKTOP_APP', 'API_SERVICE', 'DATA_SCIENCE', 'DESIGN', 'OTHER');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "availabilityExpectation" TEXT,
ADD COLUMN     "availabilityResponseExpectation" TEXT,
ADD COLUMN     "projectType" "ProjectType",
ADD COLUMN     "teamSize" INTEGER;

-- AlterTable
ALTER TABLE "ProjectRole" ADD COLUMN     "hoursPerWeek" INTEGER;
