-- AlterTable
ALTER TABLE "IssueSnapshot" ADD COLUMN     "assignees" TEXT[],
ADD COLUMN     "milestone" TEXT;

-- CreateTable
CREATE TABLE "MilestoneSnapshot" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "dueOn" TIMESTAMPTZ(3),
    "issuesOpen" INTEGER NOT NULL,
    "issuesClosed" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MilestoneSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MilestoneSnapshot_connectionId_state_dueOn_idx" ON "MilestoneSnapshot"("connectionId", "state", "dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "MilestoneSnapshot_connectionId_externalId_key" ON "MilestoneSnapshot"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "IssueSnapshot_connectionId_milestone_idx" ON "IssueSnapshot"("connectionId", "milestone");

-- AddForeignKey
ALTER TABLE "MilestoneSnapshot" ADD CONSTRAINT "MilestoneSnapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
