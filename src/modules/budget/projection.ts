import Decimal from "decimal.js";
import type { ForecastType } from "./recurrence";

/**
 * Projected balance at the end of the displayed month, per account.
 *
 * The rule, documented once: **projected = recorded balance + pending occurrences of the
 * month**. A pending occurrence is an échéance the Prévisions tab materialised and the
 * owner has not decided yet — the ones already confirmed are real transactions and are
 * therefore already inside the recorded balance. The simulated salary is deliberately
 * not added: until it is booked, no account owns it (the booking form picks one at
 * recording time), and guessing would be inventing data.
 *
 * An account with no recorded transaction has an **unknown** starting balance: nothing
 * is recorded, which is not a zero. Its projection stays unavailable — the pending net
 * is still told, but no figure is made up from it.
 */
export type AccountProjection =
  | {
      kind: "UNKNOWN";
      reason: string;
      /** Signed net of the month's pending occurrences: income positive, expense negative. */
      pendingNet: Decimal;
      pendingCount: number;
    }
  | {
      kind: "KNOWN";
      projected: Decimal;
      pendingNet: Decimal;
      pendingCount: number;
    };

export function projectAccountBalance(input: {
  recorded: { transactionCount: number; balance: Decimal };
  pending: readonly { type: ForecastType; amount: Decimal }[];
}): AccountProjection {
  const pendingNet = input.pending.reduce(
    (total, row) => total.plus(row.type === "EXPENSE" ? row.amount.negated() : row.amount),
    new Decimal(0),
  );

  if (input.recorded.transactionCount === 0) {
    return {
      kind: "UNKNOWN",
      reason:
        "Aucune opération enregistrée : le solde de départ est inconnu, la projection ne peut pas être calculée.",
      pendingNet,
      pendingCount: input.pending.length,
    };
  }

  return {
    kind: "KNOWN",
    projected: input.recorded.balance.plus(pendingNet),
    pendingNet,
    pendingCount: input.pending.length,
  };
}
