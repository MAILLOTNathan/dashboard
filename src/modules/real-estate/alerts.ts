import Decimal from "decimal.js";
import { toDateOnlyString } from "@/lib/dates";
import type { Currency } from "@/lib/money";
import type { AlertCandidate, AlertRuleConfig } from "@/modules/alerts/domain";
import { overdueEventFingerprint } from "@/modules/alerts/domain";
import { isCashflowOverdue, type CashflowKind } from "./domain";

/**
 * Overdue-event rule (BP-05): a property cashflow carries a due date in the past and is
 * not settled yet.
 *
 * It reuses `isCashflowOverdue` — the same reading the real-estate page shows — and adds
 * a configurable grace period: the alert only appears when the entry is late by **more**
 * than the grace (a grace of zero alerts the day after the due date, since the due date
 * itself is not late). An unresolved entry (neither amount nor transaction) still counts
 * as overdue; the reason then says "montant inconnu" instead of inventing a figure.
 */

export type DueCashflow = {
  id: string;
  propertyId: string;
  propertyName: string;
  label: string;
  kind: CashflowKind;
  currency: Currency;
  /** Resolved amount (entry amount or linked transaction), null when neither exists. */
  amount: Decimal | null;
  dueDate: Date | null;
  settledAt: Date | null;
};

export function evaluateOverdueEvent(
  entries: readonly DueCashflow[],
  rule: AlertRuleConfig,
  options: { now?: Date } = {},
): AlertCandidate[] {
  if (!rule.enabled) {
    return [];
  }

  const now = options.now ?? new Date();
  const grace = rule.thresholdDays ?? 0;

  // Calendar-day arithmetic in UTC, like every operation date.
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const candidates: AlertCandidate[] = [];

  for (const entry of entries) {
    if (!isCashflowOverdue(entry, new Date(today))) {
      continue;
    }

    // Both sides are DATE values at UTC midnight, so the difference is whole days.
    const daysLate = Math.round((today - (entry.dueDate?.getTime() ?? today)) / 86_400_000);
    if (daysLate <= grace) {
      continue;
    }

    candidates.push({
      kind: "OVERDUE_EVENT",
      fingerprint: overdueEventFingerprint(entry.id),
      inputs: {
        cashflowId: entry.id,
        propertyId: entry.propertyId,
        propertyName: entry.propertyName,
        label: entry.label,
        kind: entry.kind,
        currency: entry.currency,
        amount: entry.amount === null ? null : entry.amount.abs().toFixed(2),
        dueDate: entry.dueDate === null ? "" : toDateOnlyString(entry.dueDate),
        daysLate: String(daysLate),
        thresholdDays: String(grace),
      },
    });
  }

  return candidates;
}
