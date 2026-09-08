-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" DATETIME,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "invitedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Candidate" (
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
    CONSTRAINT "Candidate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Candidate_lastUpdatedById_fkey" FOREIGN KEY ("lastUpdatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Candidate" ("avatarUrl", "dataCompleteness", "discoveredAt", "experienceYearsEstimated", "headline", "httpStatus", "id", "jobId", "lastUpdatedById", "livenessCheckedAt", "location", "matchBreakdown", "matchRationale", "matchScore", "missingSignals", "name", "nextFollowUp", "notes", "outreachChannel", "outreachDate", "platform", "profileUrl", "profileUrlCanonical", "rawScrapedData", "scrapeStatus", "skillsDetected", "sourceQueryId", "sourceRunId", "sourceTier", "status", "summarySnippet", "tags", "templateUsedId", "updatedAt") SELECT "avatarUrl", "dataCompleteness", "discoveredAt", "experienceYearsEstimated", "headline", "httpStatus", "id", "jobId", "lastUpdatedById", "livenessCheckedAt", "location", "matchBreakdown", "matchRationale", "matchScore", "missingSignals", "name", "nextFollowUp", "notes", "outreachChannel", "outreachDate", "platform", "profileUrl", "profileUrlCanonical", "rawScrapedData", "scrapeStatus", "skillsDetected", "sourceQueryId", "sourceRunId", "sourceTier", "status", "summarySnippet", "tags", "templateUsedId", "updatedAt" FROM "Candidate";
DROP TABLE "Candidate";
ALTER TABLE "new_Candidate" RENAME TO "Candidate";
CREATE INDEX "Candidate_jobId_status_idx" ON "Candidate"("jobId", "status");
CREATE INDEX "Candidate_jobId_matchScore_idx" ON "Candidate"("jobId", "matchScore");
CREATE INDEX "Candidate_lastUpdatedById_idx" ON "Candidate"("lastUpdatedById");
CREATE UNIQUE INDEX "Candidate_jobId_profileUrlCanonical_key" ON "Candidate"("jobId", "profileUrlCanonical");
CREATE TABLE "new_CreditLedger" (
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
    CONSTRAINT "CreditLedger_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SearchRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CreditLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CreditLedger" ("balanceAfterReserved", "balanceAfterSpent", "cacheKey", "createdAt", "delta", "id", "kind", "periodId", "reason", "runId", "userId") SELECT "balanceAfterReserved", "balanceAfterSpent", "cacheKey", "createdAt", "delta", "id", "kind", "periodId", "reason", "runId", "userId" FROM "CreditLedger";
DROP TABLE "CreditLedger";
ALTER TABLE "new_CreditLedger" RENAME TO "CreditLedger";
CREATE INDEX "CreditLedger_periodId_createdAt_idx" ON "CreditLedger"("periodId", "createdAt");
CREATE INDEX "CreditLedger_runId_idx" ON "CreditLedger"("runId");
CREATE INDEX "CreditLedger_userId_idx" ON "CreditLedger"("userId");
CREATE TABLE "new_CreditPeriod" (
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
    "closed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "CreditPeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CreditPeriod" ("budgetLimit", "closed", "id", "lastSnapshotAt", "periodEnd", "periodStart", "providerLeft", "providerPerMonth", "providerPlanName", "providerUsage", "rateLimitPerHour", "reserved", "spent", "userId") SELECT "budgetLimit", "closed", "id", "lastSnapshotAt", "periodEnd", "periodStart", "providerLeft", "providerPerMonth", "providerPlanName", "providerUsage", "rateLimitPerHour", "reserved", "spent", "userId" FROM "CreditPeriod";
DROP TABLE "CreditPeriod";
ALTER TABLE "new_CreditPeriod" RENAME TO "CreditPeriod";
CREATE INDEX "CreditPeriod_userId_closed_idx" ON "CreditPeriod"("userId", "closed");
CREATE UNIQUE INDEX "CreditPeriod_userId_periodEnd_key" ON "CreditPeriod"("userId", "periodEnd");
CREATE TABLE "new_Job" (
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("candidateCount", "createdAt", "createdById", "id", "keywordMap", "mergedConstraints", "queryBundle", "rawJdText", "status", "structuredJd", "title", "updatedAt") SELECT "candidateCount", "createdAt", "createdById", "id", "keywordMap", "mergedConstraints", "queryBundle", "rawJdText", "status", "structuredJd", "title", "updatedAt" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_status_idx" ON "Job"("status");
CREATE INDEX "Job_createdById_idx" ON "Job"("createdById");
CREATE TABLE "new_MessageTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "roleType" TEXT,
    "tone" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MessageTemplate" ("body", "channel", "createdAt", "createdById", "id", "name", "roleType", "tone") SELECT "body", "channel", "createdAt", "createdById", "id", "name", "roleType", "tone" FROM "MessageTemplate";
DROP TABLE "MessageTemplate";
ALTER TABLE "new_MessageTemplate" RENAME TO "MessageTemplate";
CREATE INDEX "MessageTemplate_createdById_idx" ON "MessageTemplate"("createdById");
CREATE TABLE "new_OutreachLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageBody" TEXT NOT NULL,
    "notes" TEXT,
    "followUpDate" DATETIME,
    "tags" JSONB,
    "sentById" TEXT,
    CONSTRAINT "OutreachLog_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OutreachLog_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_OutreachLog" ("candidateId", "channel", "followUpDate", "id", "messageBody", "notes", "sentAt", "sentById", "tags") SELECT "candidateId", "channel", "followUpDate", "id", "messageBody", "notes", "sentAt", "sentById", "tags" FROM "OutreachLog";
DROP TABLE "OutreachLog";
ALTER TABLE "new_OutreachLog" RENAME TO "OutreachLog";
CREATE INDEX "OutreachLog_candidateId_sentAt_idx" ON "OutreachLog"("candidateId", "sentAt");
CREATE INDEX "OutreachLog_sentById_idx" ON "OutreachLog"("sentById");
CREATE TABLE "new_ProviderCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyLast4" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" DATETIME,
    CONSTRAINT "ProviderCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProviderCredential" ("authTag", "ciphertext", "createdAt", "id", "iv", "keyLast4", "label", "lastVerifiedAt", "provider", "userId") SELECT "authTag", "ciphertext", "createdAt", "id", "iv", "keyLast4", "label", "lastVerifiedAt", "provider", "userId" FROM "ProviderCredential";
DROP TABLE "ProviderCredential";
ALTER TABLE "new_ProviderCredential" RENAME TO "ProviderCredential";
CREATE UNIQUE INDEX "ProviderCredential_userId_provider_key" ON "ProviderCredential"("userId", "provider");
CREATE TABLE "new_SearchRun" (
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
    CONSTRAINT "SearchRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SearchRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SearchRun" ("abortRequested", "cacheHitCount", "candidateCount", "creditsCommitted", "creditsReleased", "creditsReserved", "errorCode", "errorMessage", "estimate", "finishedAt", "heartbeatAt", "id", "jobId", "queriesDone", "queriesTotal", "rawResultCount", "reservationExpiresAt", "resultsCap", "startedAt", "startedById", "status", "tier") SELECT "abortRequested", "cacheHitCount", "candidateCount", "creditsCommitted", "creditsReleased", "creditsReserved", "errorCode", "errorMessage", "estimate", "finishedAt", "heartbeatAt", "id", "jobId", "queriesDone", "queriesTotal", "rawResultCount", "reservationExpiresAt", "resultsCap", "startedAt", "startedById", "status", "tier" FROM "SearchRun";
DROP TABLE "SearchRun";
ALTER TABLE "new_SearchRun" RENAME TO "SearchRun";
CREATE INDEX "SearchRun_status_heartbeatAt_idx" ON "SearchRun"("status", "heartbeatAt");
CREATE INDEX "SearchRun_startedById_idx" ON "SearchRun"("startedById");
CREATE TABLE "new_SerpQueryCache" (
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
    "fetchedById" TEXT,
    CONSTRAINT "SerpQueryCache_fetchedById_fkey" FOREIGN KEY ("fetchedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SerpQueryCache" ("costedCredits", "engine", "expiresAt", "fetchedAt", "fetchedById", "hitCount", "isNegative", "key", "lastHitAt", "params", "queryString", "rawResponse", "resultCount") SELECT "costedCredits", "engine", "expiresAt", "fetchedAt", "fetchedById", "hitCount", "isNegative", "key", "lastHitAt", "params", "queryString", "rawResponse", "resultCount" FROM "SerpQueryCache";
DROP TABLE "SerpQueryCache";
ALTER TABLE "new_SerpQueryCache" RENAME TO "SerpQueryCache";
CREATE INDEX "SerpQueryCache_expiresAt_idx" ON "SerpQueryCache"("expiresAt");
CREATE INDEX "SerpQueryCache_fetchedById_idx" ON "SerpQueryCache"("fetchedById");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_email_key" ON "Invite"("email");
