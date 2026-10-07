-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('LOW_BALANCE', 'BUDGET_OVERRUN', 'UNUSUAL_EXPENSE', 'STALE_INTEGRATION', 'OVERDUE_EVENT');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'DISMISSED', 'RESOLVED');

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "inputs" JSONB NOT NULL,
    "triggeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "dismissedAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "thresholdAmount" DECIMAL(18,2),
    "thresholdCurrency" CHAR(3),
    "thresholdPercent" DECIMAL(6,2),
    "thresholdDays" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Alert_userId_status_idx" ON "Alert"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_userId_fingerprint_key" ON "Alert"("userId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "AlertRule_userId_kind_key" ON "AlertRule"("userId", "kind");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
