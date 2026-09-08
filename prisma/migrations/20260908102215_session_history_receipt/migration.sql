-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SearchRunQuery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "queryType" TEXT NOT NULL DEFAULT 'custom',
    "queryString" TEXT NOT NULL,
    "canonicalHash" TEXT NOT NULL,
    "provider" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "creditCost" INTEGER NOT NULL DEFAULT 0,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "keptCount" INTEGER NOT NULL DEFAULT 0,
    "validationErrors" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "latencyMs" INTEGER,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "SearchRunQuery_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SearchRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SearchRunQuery" ("canonicalHash", "creditCost", "errorCode", "errorMessage", "finishedAt", "id", "keptCount", "latencyMs", "outcome", "platform", "queryId", "queryString", "resultCount", "runId", "startedAt", "validationErrors") SELECT "canonicalHash", "creditCost", "errorCode", "errorMessage", "finishedAt", "id", "keptCount", "latencyMs", "outcome", "platform", "queryId", "queryString", "resultCount", "runId", "startedAt", "validationErrors" FROM "SearchRunQuery";
DROP TABLE "SearchRunQuery";
ALTER TABLE "new_SearchRunQuery" RENAME TO "SearchRunQuery";
CREATE INDEX "SearchRunQuery_runId_idx" ON "SearchRunQuery"("runId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
