import Decimal from "decimal.js";
import type { Currency } from "@/lib/money";
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

/** One upcoming month's dated movements, for the simulated-balance walk. */
export type SimulatedMonthMovements = {
  key: string;
  /** Signed net of the recorded operations dated in this month, per currency. */
  recorded: ReadonlyMap<Currency, Decimal>;
  /** Signed net of the month's pending movements, per currency. */
  pending: ReadonlyMap<Currency, Decimal>;
};

/**
 * The simulated balance at the end of each upcoming month, per currency.
 *
 * The rule, documented once: **simulated = recorded cumulative strictly before the
 * window +, month by month, everything dated in that month** — recorded operations (a
 * booked salary included: it is a real transaction) plus pending movements (planned
 * occurrences, simulated salary). Nothing is counted twice: pending contributions carry
 * no transaction by definition. A currency with no recorded operation at all stays
 * **absent** from every month's map — nothing is recorded, which is not a zero. Each
 * month gets its own copy, so a later month never rewrites an earlier figure.
 */
export function buildSimulatedBalances(input: {
  recordedBefore: ReadonlyMap<Currency, Decimal>;
  months: readonly SimulatedMonthMovements[];
}): { key: string; balances: Map<Currency, Decimal> }[] {
  const zero = new Decimal(0);
  const currencies = new Set<Currency>(input.recordedBefore.keys());

  for (const month of input.months) {
    for (const currency of month.recorded.keys()) {
      currencies.add(currency);
    }
  }

  const running = new Map<Currency, Decimal>();
  for (const currency of currencies) {
    running.set(currency, input.recordedBefore.get(currency) ?? zero);
  }

  return input.months.map((month) => {
    // Every known currency advances on every month, even when this month has no row for
    // it: a later row must still carry the full history.
    for (const currency of currencies) {
      const delta = (month.recorded.get(currency) ?? zero).plus(
        month.pending.get(currency) ?? zero,
      );
      running.set(currency, (running.get(currency) ?? zero).plus(delta));
    }

    return { key: month.key, balances: new Map(running) };
  });
}
