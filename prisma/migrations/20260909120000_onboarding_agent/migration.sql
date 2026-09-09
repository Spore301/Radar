-- AlterTable
ALTER TABLE "User" ADD COLUMN "company" TEXT;
ALTER TABLE "User" ADD COLUMN "onboardedAt" DATETIME;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "agentTranscript" JSONB;
