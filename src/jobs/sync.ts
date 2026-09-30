import { ProviderError, type IntegrationAdapter } from "@/modules/integrations/adapter";
import type { IntegrationProvider } from "@/modules/integrations/domain";
import { createGitHubAdapter } from "@/modules/integrations/github";
import { createGitLabAdapter } from "@/modules/integrations/gitlab";
import {
  findConnectionForSync,
  listConnections,
  markSyncFailure,
  markSyncSuccess,
  saveSnapshots,
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

  try {
    const outcome = await adapter.listProjects({
      token: connection.token,
      instanceUrl: connection.instanceUrl,
      owner: connection.externalOwner,
      fetchImpl: dependencies.fetchImpl,
    });

    await saveSnapshots({
      connectionId: connection.id,
      provider: connection.provider,
      projects: outcome.projects,
      fetchedAt: outcome.fetchedAt,
      // Every page was read, so snapshots the provider no longer returns can go.
      pruneMissing: true,
    });

    await markSyncSuccess(connection.id, outcome.fetchedAt);

    return {
      connectionId: connection.id,
      provider: connection.provider,
      status: "SYNCHRONISED",
      projectCount: outcome.projects.length,
      fetchedAt: outcome.fetchedAt,
    };
  } catch (error) {
    // Only a safe, token-free summary is persisted for display.
    const safeMessage =
      error instanceof ProviderError
        ? error.toSafeMessage()
        : "UNEXPECTED_ERROR";

    await markSyncFailure(connection.id, safeMessage);

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
