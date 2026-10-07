import type { AlertCandidate, AlertRuleConfig } from "@/modules/alerts/domain";
import { staleIntegrationFingerprint } from "@/modules/alerts/domain";
import { describeInstance, isSyncStale, type ConnectionSummary } from "./domain";

/**
 * Stale-integration rule (BP-05): the last successful synchronisation is older than the
 * configured number of days.
 *
 * It reuses `isSyncStale`, the very helper the dashboard already displays, so the alert
 * and the badge can never disagree. A connection that has **never** synchronised is not
 * "stale": its data is missing, not old, and the Integrations page already says so —
 * an alert would present a missing value as a confirmed anomaly.
 */
export function evaluateStaleIntegration(
  connections: readonly ConnectionSummary[],
  rule: AlertRuleConfig,
  options: { now: Date },
): AlertCandidate[] {
  if (!rule.enabled) {
    return [];
  }

  const days = rule.thresholdDays ?? 1;
  const candidates: AlertCandidate[] = [];

  for (const connection of connections) {
    if (connection.lastSyncedAt === null) {
      continue;
    }

    if (!isSyncStale(connection.lastSyncedAt, options.now, days * 24)) {
      continue;
    }

    const daysSince = Math.floor(
      (options.now.getTime() - connection.lastSyncedAt.getTime()) / 86_400_000,
    );

    candidates.push({
      kind: "STALE_INTEGRATION",
      fingerprint: staleIntegrationFingerprint(connection.id),
      inputs: {
        connectionId: connection.id,
        provider: connection.provider,
        instance: describeInstance(connection.provider, connection.instanceUrl),
        lastSyncedAt: connection.lastSyncedAt.toISOString(),
        daysSince: String(daysSince),
        thresholdDays: String(days),
      },
    });
  }

  return candidates;
}
