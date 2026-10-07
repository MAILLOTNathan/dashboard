import Decimal from "decimal.js";
import type { Currency } from "@/lib/money";
import type { TransactionRecord } from "./domain";
import {
  computeMonthlyTotals,
  groupByCurrency,
  type MonthlyTotals,
} from "./totals";

/**
 * Comparison of the displayed month with the previous month and the same month last
 * year, per currency (see `computeMonthlyTotals` for what counts as income, expenses
 * and net — transfers included by their sign).
 *
 * The rules, documented once here:
 * - A side with **no transactions at all** in that currency is `null` — "no data", never
 *   a zero month. The UI renders it as "aucune donnée", and no delta is computed
 *   against it.
 * - `netDelta` is `current.net − previous.net`, signed: a positive delta means the net
 *   improved. It is `null` when the previous month holds no data.
 * - `netPercent` divides the delta by the **absolute value** of the previous net, so its
 *   sign follows the delta (a negative base does not flip comparisons). It stays `null`
 *   when the previous net is exactly zero: dividing by zero has no honest percentage.
 * - Currencies are never mixed: rows are keyed by the current month's currencies.
 */

export type ComparisonRow = {
  currency: Currency;
  current: MonthlyTotals;
  /** `null` when the previous month holds nothing in this currency. */
  previous: MonthlyTotals | null;
  /** `null` when the same month last year holds nothing in this currency. */
  sameMonthLastYear: MonthlyTotals | null;
  /** current.net − previous.net, or `null` without a previous month. */
  netDelta: Decimal | null;
  /** Delta as a percentage of |previous.net|, one decimal; `null` when undefined. */
  netPercent: Decimal | null;
};

function totalsByCurrency(
  transactions: readonly TransactionRecord[],
): Map<Currency, MonthlyTotals> {
  const map = new Map<Currency, MonthlyTotals>();

  for (const [currency, group] of groupByCurrency(transactions)) {
    map.set(currency, computeMonthlyTotals(group, { currency }));
  }

  return map;
}

export function buildComparison(input: {
  current: readonly TransactionRecord[];
  previous: readonly TransactionRecord[];
  sameMonthLastYear: readonly TransactionRecord[];
}): ComparisonRow[] {
  const currentTotals = totalsByCurrency(input.current);
  const previousTotals = totalsByCurrency(input.previous);
  const lastYearTotals = totalsByCurrency(input.sameMonthLastYear);

  return [...currentTotals.values()].map((current) => {
    const previous = previousTotals.get(current.currency) ?? null;
    const sameMonthLastYear = lastYearTotals.get(current.currency) ?? null;

    let netDelta: Decimal | null = null;
    let netPercent: Decimal | null = null;

    if (previous !== null) {
      netDelta = current.net.minus(previous.net);

      if (!previous.net.isZero()) {
        netPercent = netDelta
          .dividedBy(previous.net.abs())
          .times(100)
          .toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
      }
    }

    return { currency: current.currency, current, previous, sameMonthLastYear, netDelta, netPercent };
  });
}
