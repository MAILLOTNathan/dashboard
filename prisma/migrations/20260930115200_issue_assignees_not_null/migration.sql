-- Prisma types a scalar list as non-nullable, but `ADD COLUMN "assignees" TEXT[]`
-- left every existing row NULL: Prisma would hand back `null` typed as `string[]`,
-- and the first `.map()` on it would fail at runtime. Backfill, then enforce.
UPDATE "IssueSnapshot" SET "assignees" = ARRAY[]::TEXT[] WHERE "assignees" IS NULL;

ALTER TABLE "IssueSnapshot" ALTER COLUMN "assignees" SET NOT NULL;
ALTER TABLE "IssueSnapshot" ALTER COLUMN "assignees" SET DEFAULT ARRAY[]::TEXT[];
