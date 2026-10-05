import { ProviderError, type IntegrationAdapter } from "@/modules/integrations/adapter";
import type { IntegrationProvider, SyncRunStatus } from "@/modules/integrations/domain";
import { createGitHubAdapter } from "@/modules/integrations/github";
import { createGitLabAdapter } from "@/modules/integrations/gitlab";
import { createRetryingFetch, type RetryPolicy } from "@/modules/integrations/retry";
import {
  findConnectionForSync,
  finishSyncRun,
  listConnections,
  markSyncFailure,
  markSyncSuccess,
  saveIssues,
  saveMilestones,
  saveSnapshots,
  startSyncRun,
} from "@/modules/integrations/repository";

/**
 * Deferred synchronisation.
 *
 * This is a **job**, not a loop: the web process must stay replaceable, so a run
 * is triggered by a scheduler outside it (cron, systemd timer, platform
 * scheduler) through a script that imports these functions.
 *
 * A run is idempotent: snapshots are keyed by (connection, external project id),
 * so replaying a synchronisation updates existing rows instead of duplicating
 * them. Nothing is written if a run fails halfway: a partial synchronisation
 * must not erase projects that were merely not fetched.
 *
 * Every attempt is recorded as a `SyncRun` row (counters, status, safe error,
 * bounded retries), which is what lets the interface display freshness and explain
 * a partial or failed pass instead of showing a misleading zero.
 */

export function adapterFor(provider: IntegrationProvider): IntegrationAdapter {
  switch (provider) {
    case "GITHUB":
      return createGitHubAdapter();
    case "GITLAB":
      return createGitLabAdapter();
  }
}

export type SyncRunResult =
  | {
      connectionId: string;
      provider: IntegrationProvider;
      status: "SYNCHRONISED";
      projectCount: number;
      /** Open issues and pull requests followed after this run. */
      issueCount: number;
      /** False when the provider's issues are deliberately not fetched. */
      issueTracking: boolean;
      /** Repositories left out of the issue fetch because of the run bound. */
      issuesSkippedRepositories: number;
      /** Milestones followed after this run. */
      milestoneCount: number;
      /** Bounded retries used by this run (transient failures only). */
      retries: number;
      fetchedAt: Date;
    }
  | {
      connectionId: string;
      provider: IntegrationProvider;
      status: "SKIPPED";
      reason: "NO_TOKEN" | "NOT_FOUND";
    }
  | {
      connectionId: string;
      provider: IntegrationProvider;
      status: "FAILED";
      code: string;
    };

export type SyncDependencies = {
  /** Injected by tests so that no test reaches the network. */
  fetchImpl?: typeof fetch;
  /** Retry policy override, injected by tests; production uses the default. */
  retryPolicy?: Partial<RetryPolicy>;
  /** Injected by tests so a retry does not wait in real time. */
  sleep?: (delayMs: number) => Promise<void>;
  /** Injected by tests so the jitter is deterministic. */
  random?: () => number;
};

export async function synchroniseConnection(
  userId: string,
  connectionId: string,
  dependencies: SyncDependencies = {},
): Promise<SyncRunResult> {
  const connection = await findConnectionForSync(userId, connectionId);

  if (!connection) {
    return {
      connectionId,
      provider: "GITHUB",
      status: "SKIPPED",
      reason: "NOT_FOUND",
    };
  }

  if (!connection.token) {
    // An unreadable or absent token is a real state, not an error to hide.
    return {
      connectionId,
      provider: connection.provider,
      status: "SKIPPED",
      reason: "NO_TOKEN",
    };
  }

  const adapter = adapterFor(connection.provider);

  // One wrapper per run: it only retries transient failures, and its counter feeds
  // the run history. The adapters keep the injected `fetch` they always had.
  const retryingFetch = createRetryingFetch({
    fetchImpl: dependencies.fetchImpl ?? fetch,
    policy: dependencies.retryPolicy,
    sleep: dependencies.sleep,
    random: dependencies.random,
  });

  // A run row exists for every attempt that starts; it is closed on success, on a
  // partial read and on failure alike, so it can never linger as `RUNNING`.
  const runId = await startSyncRun(connection.id);

  let fetched = 0;
  let created = 0;
  let updated = 0;

  try {
    const outcome = await adapter.listProjects({
      token: connection.token,
      instanceUrl: connection.instanceUrl,
      owner: connection.externalOwner,
      fetchImpl: retryingFetch.fetchImpl,
    });

    const savedProjects = await saveSnapshots({
      connectionId: connection.id,
      provider: connection.provider,
      projects: outcome.projects,
      fetchedAt: outcome.fetchedAt,
      // Every page was read, so snapshots the provider no longer returns can go.
      pruneMissing: true,
    });
    fetched += outcome.projects.length;
    created += savedProjects.created;
    updated += savedProjects.updated;

    // Issues come from the projects of the same run: one synchronisation, one view.
    const issues = await adapter.listIssues({
      token: connection.token,
      instanceUrl: connection.instanceUrl,
      owner: connection.externalOwner,
      projects: outcome.projects,
      fetchImpl: retryingFetch.fetchImpl,
    });

    const savedIssues = await saveIssues({
      connectionId: connection.id,
      provider: connection.provider,
      issues: issues.issues,
      fetchedAt: issues.fetchedAt,
      // Pruning removes closed issues, which is what keeps the list actionable. It is
      // only safe when every targeted repository was read: a repository skipped by the
      // bound, or refused by the provider, still has open issues that were not seen.
      pruneMissing:
        issues.supported &&
        issues.repositoriesSkipped === 0 &&
        issues.repositoriesFailed === 0,
    });
    fetched += issues.issues.length;
    created += savedIssues.created;
    updated += savedIssues.updated;

    // Milestones come from the same repository selection, so the two views describe
    // exactly the same scope.
    const milestones = await adapter.listMilestones({
      token: connection.token,
      instanceUrl: connection.instanceUrl,
      owner: connection.externalOwner,
      projects: outcome.projects,
      fetchImpl: retryingFetch.fetchImpl,
    });

    const savedMilestones = await saveMilestones({
      connectionId: connection.id,
      provider: connection.provider,
      milestones: milestones.milestones,
      fetchedAt: milestones.fetchedAt,
      pruneMissing:
        milestones.supported &&
        milestones.repositoriesSkipped === 0 &&
        milestones.repositoriesFailed === 0,
    });
    fetched += milestones.milestones.length;
    created += savedMilestones.created;
    updated += savedMilestones.updated;

    // Both scans cover the same repository selection, so their skipped and failed
    // counts describe the same set of repositories: keep the maximum instead of
    // counting the same repository twice. Either number means "not read" — the data
    // of those repositories is unknown, not empty.
    const skipped = Math.max(issues.repositoriesSkipped, milestones.repositoriesSkipped);
    const failed = Math.max(issues.repositoriesFailed, milestones.repositoriesFailed);
    const status: SyncRunStatus = skipped > 0 || failed > 0 ? "PARTIAL" : "SUCCESS";

    await markSyncSuccess(connection.id, outcome.fetchedAt);
    await finishSyncRun(runId, {
      status,
      fetched,
      created,
      updated,
      skipped,
      failed,
      retries: retryingFetch.retries(),
    });

    return {
      connectionId: connection.id,
      provider: connection.provider,
      status: "SYNCHRONISED",
      projectCount: outcome.projects.length,
      issueCount: issues.issues.length,
      issueTracking: issues.supported,
      issuesSkippedRepositories: issues.repositoriesSkipped,
      milestoneCount: milestones.milestones.length,
      retries: retryingFetch.retries(),
      fetchedAt: outcome.fetchedAt,
    };
  } catch (error) {
    // Only a safe, token-free summary is persisted for display.
    const safeMessage =
      error instanceof ProviderError
        ? error.toSafeMessage()
        : "UNEXPECTED_ERROR";

    await markSyncFailure(connection.id, safeMessage);
    // The counters show what the run had already read before it stopped; the safe
    // summary explains why. Neither ever contains a token or a response body.
    await finishSyncRun(runId, {
      status: "FAILED",
      fetched,
      created,
      updated,
      skipped: 0,
      failed: 0,
      retries: retryingFetch.retries(),
      errorSummary: safeMessage,
    });

    return {
      connectionId: connection.id,
      provider: connection.provider,
      status: "FAILED",
      code: safeMessage,
    };
  }
}

/** One run for every connection of the owner; one failure never blocks the others. */
export async function synchroniseAllConnections(
  userId: string,
  dependencies: SyncDependencies = {},
): Promise<SyncRunResult[]> {
  const connections = await listConnections(userId);
  const results: SyncRunResult[] = [];

  for (const connection of connections) {
    results.push(await synchroniseConnection(userId, connection.id, dependencies));
  }

  return results;
}
