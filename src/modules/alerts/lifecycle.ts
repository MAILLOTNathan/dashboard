import type { AlertCandidate, AlertStatus } from "./domain";

/**
 * Alert lifecycle, as a pure plan (BP-05).
 *
 * The engine reads the conditions that hold right now (candidates) and the rows that
 * already exist, and decides what to write — nothing here touches a database, which is
 * what makes the rules below testable without one.
 *
 * The rules, in one place:
 *
 * - a candidate with no row → **create** an ACTIVE episode;
 * - a candidate matching an ACTIVE row → **refresh** it (inputs and `lastSeenAt` move,
 *   `triggeredAt` does not: the episode is the same);
 * - a candidate matching a DISMISSED row → refresh it and leave it dismissed: the
 *   owner's choice sticks while the condition holds;
 * - a candidate matching a RESOLVED row → **reopen** it as a new episode (fresh
 *   `triggeredAt`, dismissal cleared): it resolved first, then re-triggered;
 * - a row whose candidate is gone → **resolve** it (from ACTIVE or DISMISSED, never
 *   from RESOLVED, which is already settled).
 *
 * The Dismissed→Resolved transition is deliberate: a dismissal silences the current
 * episode, not the rule. Once the condition disappears, the next re-trigger asks again.
 */

export type AlertLifecycleRow = {
  id: string;
  fingerprint: string;
  status: AlertStatus;
};

export type ReopenedAlert = { id: string; candidate: AlertCandidate };

export type AlertLifecyclePlan = {
  creates: AlertCandidate[];
  refreshes: ReopenedAlert[];
  reopens: ReopenedAlert[];
  /** Identifiers of the rows to close. */
  resolves: string[];
};

/**
 * What to write, given the stored rows and the freshly evaluated candidates.
 *
 * Candidates are deduplicated by fingerprint (first one wins): a rule that emitted the
 * same condition twice in one pass must not race its own unique constraint.
 */
export function planAlertChanges(
  existing: readonly AlertLifecycleRow[],
  candidates: readonly AlertCandidate[],
): AlertLifecyclePlan {
  const unique = new Map<string, AlertCandidate>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.fingerprint)) {
      unique.set(candidate.fingerprint, candidate);
    }
  }

  const byFingerprint = new Map(existing.map((row) => [row.fingerprint, row]));

  const plan: AlertLifecyclePlan = {
    creates: [],
    refreshes: [],
    reopens: [],
    resolves: [],
  };

  for (const candidate of unique.values()) {
    const row = byFingerprint.get(candidate.fingerprint);

    if (!row) {
      plan.creates.push(candidate);
    } else if (row.status === "RESOLVED") {
      plan.reopens.push({ id: row.id, candidate });
    } else {
      // ACTIVE keeps its episode, DISMISSED keeps its silence; both refresh their inputs.
      plan.refreshes.push({ id: row.id, candidate });
    }
  }

  for (const row of existing) {
    if (!unique.has(row.fingerprint) && row.status !== "RESOLVED") {
      plan.resolves.push(row.id);
    }
  }

  return plan;
}
