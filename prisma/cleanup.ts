import "dotenv/config";
import { cleanUpSyncRuns, SYNC_RUN_RETENTION_DAYS } from "../src/jobs/retention";

/**
 * Bounded cleanup of synchronisation history.
 *
 * Run it from a workstation (`npm run db:cleanup`) or from the database tooling
 * image (`docker compose --profile full run --rm migrate npm run db:cleanup`).
 * Nothing schedules it on purpose: a cleanup is an operator decision, like every
 * other deferred job of this repository.
 *
 * Only runs older than the retention period are deleted, and the most recent
 * successful run of each connection is always kept.
 */
async function main(): Promise<void> {
  const result = await cleanUpSyncRuns();

  console.log(
    `Synchronisation history: ${result.deleted} run(s) deleted for ${result.owners} owner(s) (retention: ${SYNC_RUN_RETENTION_DAYS} days).`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    // Nothing to close explicitly: the Prisma client is released with the process.
  });
