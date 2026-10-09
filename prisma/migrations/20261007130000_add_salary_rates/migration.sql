-- CreateTable
CREATE TABLE "SalaryRate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "hourlyRate" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SalaryRate_pkey" PRIMARY KEY ("id")
);

-- Backfill: the owner's single rate becomes the first change point, effective from the
-- month the simulator was configured. It keeps every existing simulation figure
-- identical; months before it simply have no rate, which is the new explicit state
-- rather than an invented default.
INSERT INTO "SalaryRate" ("id", "userId", "year", "month", "hourlyRate", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    "userId",
    EXTRACT(YEAR FROM ("createdAt" AT TIME ZONE 'UTC'))::int,
    EXTRACT(MONTH FROM ("createdAt" AT TIME ZONE 'UTC'))::int,
    "hourlyRate",
    NOW(),
    NOW()
FROM "SalarySetting";

-- AlterTable
ALTER TABLE "SalarySetting" DROP COLUMN "hourlyRate";

-- CreateIndex
CREATE UNIQUE INDEX "SalaryRate_userId_year_month_key" ON "SalaryRate"("userId", "year", "month");

-- AddForeignKey
ALTER TABLE "SalaryRate" ADD CONSTRAINT "SalaryRate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
