-- Stage tracking for the pipeline board. The new OutreachChannel value
-- ("LinkedIn Note") needs no SQL: SQLite stores Prisma enums as TEXT.
ALTER TABLE "Candidate" ADD COLUMN "stageChangedAt" DATETIME;
