-- CreateEnum
CREATE TYPE "IssueKind" AS ENUM ('ISSUE', 'PULL_REQUEST');

-- CreateTable
CREATE TABLE "IssueSnapshot" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" "IssueKind" NOT NULL,
    "repository" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "authorLogin" TEXT,
    "commentsCount" INTEGER NOT NULL,
    "labels" TEXT[],
    "openedAt" TIMESTAMPTZ(3) NOT NULL,
    "activityAt" TIMESTAMPTZ(3) NOT NULL,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IssueSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueSnapshot_connectionId_fetchedAt_idx" ON "IssueSnapshot"("connectionId", "fetchedAt");

-- CreateIndex
CREATE INDEX "IssueSnapshot_connectionId_kind_openedAt_idx" ON "IssueSnapshot"("connectionId", "kind", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IssueSnapshot_connectionId_externalId_key" ON "IssueSnapshot"("connectionId", "externalId");

-- AddForeignKey
ALTER TABLE "IssueSnapshot" ADD CONSTRAINT "IssueSnapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
