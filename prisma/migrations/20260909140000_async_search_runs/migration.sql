-- Live progress for background search runs.
ALTER TABLE "SearchRun" ADD COLUMN "stage" TEXT;
ALTER TABLE "SearchRun" ADD COLUMN "statusText" TEXT;
