import { getPrisma } from "@/lib/db";
import { pruneSyncRuns } from "@/modules/integrations/repository";

/**
 * Retention of synchronisation history.
 *
 * Provider snapshots are current state, not history: a run replaces them, and issue
 * pruning already removes what the provider no longer reports as open. What grows
 * without bound is the run history, so that is what this policy bounds.
 *
 * The cleanup is run deliberately — by the owner or by an external scheduler — and
 * never from the web process. It is owner-scoped, bounded by the cutoff and safe to
 * re-run; the most recent successful run of each connection is always kept, so the
 * freshness display survives a long pause.
 */
export const SYNC_RUN_RETENTION_DAYS = 90;

export function retentionCutoff(
  now: Date,
  retentionDays: number = SYNC_RUN_RETENTION_DAYS,
): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export async function cleanUpSyncRuns(
  options: { now?: Date; retentionDays?: number } = {},
): Promise<{ owners: number; deleted: number }> {
  const now = options.now ?? new Date();
  const olderThan = retentionCutoff(now, options.retentionDays);

  const owners = await getPrisma().user.findMany({ select: { id: true } });

  let deleted = 0;
  for (const owner of owners) {
    deleted += await pruneSyncRuns({ userId: owner.id, olderThan });
  }

  return { owners: owners.length, deleted };
}
