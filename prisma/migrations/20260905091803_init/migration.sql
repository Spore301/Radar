-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "rawJdText" TEXT NOT NULL,
    "structuredJd" JSONB NOT NULL,
    "mergedConstraints" JSONB NOT NULL,
    "queryBundle" JSONB NOT NULL,
    "keywordMap" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "profileUrl" TEXT NOT NULL,
    "profileUrlCanonical" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "skillsDetected" JSONB NOT NULL,
    "experienceYearsEstimated" INTEGER,
    "summarySnippet" TEXT NOT NULL,
    "matchScore" INTEGER NOT NULL,
    "matchBreakdown" JSONB NOT NULL,
    "matchRationale" TEXT NOT NULL,
    "missingSignals" JSONB NOT NULL,
    "dataCompleteness" REAL NOT NULL,
    "rawScrapedData" JSONB,
    "sourceQueryId" TEXT,
    "sourceRunId" TEXT,
    "sourceTier" TEXT,
    "httpStatus" INTEGER,
    "livenessCheckedAt" DATETIME,
    "scrapeStatus" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'New',
    "outreachChannel" TEXT,
    "outreachDate" DATETIME,
    "nextFollowUp" DATETIME,
    "notes" TEXT,
    "tags" JSONB,
    "templateUsedId" TEXT,
    "lastUpdatedById" TEXT,
    "discoveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Candidate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutreachLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageBody" TEXT NOT NULL,
    "notes" TEXT,
    "followUpDate" DATETIME,
    "tags" JSONB,
    "sentById" TEXT,
    CONSTRAINT "OutreachLog_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "roleType" TEXT,
    "tone" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SearchRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "resultsCap" INTEGER NOT NULL,
    "estimate" JSONB,
    "creditsReserved" INTEGER NOT NULL DEFAULT 0,
    "creditsCommitted" INTEGER NOT NULL DEFAULT 0,
    "creditsReleased" INTEGER NOT NULL DEFAULT 0,
    "cacheHitCount" INTEGER NOT NULL DEFAULT 0,
    "queriesTotal" INTEGER NOT NULL DEFAULT 0,
    "queriesDone" INTEGER NOT NULL DEFAULT 0,
    "rawResultCount" INTEGER NOT NULL DEFAULT 0,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "abortRequested" BOOLEAN NOT NULL DEFAULT false,
    "reservationExpiresAt" DATETIME,
    "heartbeatAt" DATETIME,
    "startedById" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    CONSTRAINT "SearchRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SearchRunQuery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "queryString" TEXT NOT NULL,
    "canonicalHash" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "SerpQueryCache" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "engine" TEXT NOT NULL,
    "queryString" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "rawResponse" JSONB NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "isNegative" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" DATETIME,
    "costedCredits" INTEGER NOT NULL DEFAULT 1,
    "fetchedById" TEXT
);

-- CreateTable
CREATE TABLE "CreditPeriod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "budgetLimit" INTEGER NOT NULL,
    "spent" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "providerPlanName" TEXT,
    "providerPerMonth" INTEGER,
    "providerLeft" INTEGER,
    "providerUsage" INTEGER,
    "rateLimitPerHour" INTEGER,
    "lastSnapshotAt" DATETIME,
    "closed" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodId" TEXT NOT NULL,
    "runId" TEXT,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT,
    "cacheKey" TEXT,
    "balanceAfterSpent" INTEGER NOT NULL,
    "balanceAfterReserved" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditLedger_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "CreditPeriod" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CreditLedger_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SearchRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyLast4" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Candidate_jobId_status_idx" ON "Candidate"("jobId", "status");

-- CreateIndex
CREATE INDEX "Candidate_jobId_matchScore_idx" ON "Candidate"("jobId", "matchScore");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_jobId_profileUrlCanonical_key" ON "Candidate"("jobId", "profileUrlCanonical");

-- CreateIndex
CREATE INDEX "OutreachLog_candidateId_sentAt_idx" ON "OutreachLog"("candidateId", "sentAt");

-- CreateIndex
CREATE INDEX "SearchRun_status_heartbeatAt_idx" ON "SearchRun"("status", "heartbeatAt");

-- CreateIndex
CREATE INDEX "SearchRunQuery_runId_idx" ON "SearchRunQuery"("runId");

-- CreateIndex
CREATE INDEX "SerpQueryCache_expiresAt_idx" ON "SerpQueryCache"("expiresAt");

-- CreateIndex
CREATE INDEX "CreditPeriod_userId_closed_idx" ON "CreditPeriod"("userId", "closed");

-- CreateIndex
CREATE UNIQUE INDEX "CreditPeriod_userId_periodEnd_key" ON "CreditPeriod"("userId", "periodEnd");

-- CreateIndex
CREATE INDEX "CreditLedger_periodId_createdAt_idx" ON "CreditLedger"("periodId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditLedger_runId_idx" ON "CreditLedger"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCredential_userId_provider_key" ON "ProviderCredential"("userId", "provider");
