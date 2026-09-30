import Decimal from "decimal.js";
import { monthRange, parseMonthKey } from "@/lib/dates";
import type { TransactionRecord, TransactionType } from "./domain";
import { computeMonthlyTotals, type MonthlyTotals } from "./totals";

/**
 * Data for the budget charts.
 *
 * Charts are not decoration here: each one answers a question the table cannot.
 * The monthly table shows one month at a time, so it hides the trend; a column of
 * amounts hides where the money actually goes. Every series below reuses the
 * documented aggregation rules rather than inventing its own, so a number in a
 * chart always equals the same number in a table:
 *
 * - transfers are excluded from income, expenses and net;
 * - expenses are reported positive, and a refund (a positive amount on an EXPENSE
 *   transaction) reduces them;
 * - currencies are never mixed: the caller passes the transactions of one currency.
 */

export type MonthlySeriesPoint = {
  monthKey: string;
  year: number;
  /** 1-based month, as a human writes it. */
  month: number;
  totals: MonthlyTotals;
};

/**
 * One point per requested month, zeros included.
 *
 * A month without any transaction returns zeros rather than being skipped: a gap in
 * a chart must read as "nothing was recorded", not as a missing bar that silently
 * compresses the time axis.
 */
export function buildMonthlySeries(
  transactions: readonly TransactionRecord[],
  monthKeys: readonly string[],
): MonthlySeriesPoint[] {
  return monthKeys.map((monthKey) => {
    const { year, month } = parseMonthKey(monthKey);
    const { start, end } = monthRange(year, month);

    return {
      monthKey,
      year,
      month,
      totals: computeMonthlyTotals(
        transactions.filter(
          (transaction) =>
            transaction.operationDate.getTime() >= start.getTime() &&
            transaction.operationDate.getTime() < end.getTime(),
        ),
      ),
    };
  });
}

export type CategoryBreakdownEntry = {
  /** Category identifier, or a synthetic key for "uncategorized" and the tail. */
  key: string;
  label: string;
  /**
   * Signed like the monthly totals: a category with more refunds than expenses is
   * legitimately negative.
   */
  amount: Decimal;
  /** Fraction of the total for that kind. Zero when the total itself is zero. */
  share: number;
};

export type CategoryBreakdown = {
  entries: CategoryBreakdownEntry[];
  /** Total for the kind, tail included, so the bars can be verified against it. */
  total: Decimal;
};

export const UNCATEGORISED_KEY = "uncategorized";
export const UNCATEGORISED_LABEL = "Sans catégorie";

/**
 * Where the money went, per category, for one kind of transaction.
 *
 * `EXPENSE` is the useful default; `INCOME` answers "where does my income come
 * from?". Categories are ordered by weight descending, and the transactions without
 * a category are kept as their own line: an unnamed expense is still money spent,
 * and dropping it would make the bars fail to add up.
 *
 * `limit` is the maximum number of rows drawn, the merged "Autres" line included,
 * so the chart keeps the height it was designed for while the total stays exact.
 */
export function buildCategoryBreakdown(
  transactions: readonly TransactionRecord[],
  options: { kind: TransactionType; limit?: number },
): CategoryBreakdown {
  const { kind, limit } = options;

  const buckets = new Map<string, { label: string; amount: Decimal }>();
  let total = new Decimal(0);

  for (const transaction of transactions) {
    if (transaction.type !== kind) {
      continue;
    }

    // An expense is stored negative: the magnitude is its negated amount, which
    // makes a refund reduce its category exactly as it reduces the monthly total.
    const contribution = kind === "EXPENSE" ? transaction.amount.negated() : transaction.amount;
    const key = transaction.categoryId ?? UNCATEGORISED_KEY;
    const label = transaction.categoryName ?? UNCATEGORISED_LABEL;

    const bucket = buckets.get(key) ?? { label, amount: new Decimal(0) };
    bucket.amount = bucket.amount.plus(contribution);
    buckets.set(key, bucket);

    total = total.plus(contribution);
  }

  const ranked = [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      amount: bucket.amount,
      share: shareOf(bucket.amount, total),
    }))
    .sort((left, right) => right.amount.comparedTo(left.amount) ?? 0);

  // `limit` counts the rows drawn: the merged tail takes the last slot.
  const rows = limit === undefined ? ranked.length : Math.max(1, limit);

  if (rows >= ranked.length) {
    return { entries: ranked, total };
  }

  const kept = ranked.slice(0, rows - 1);
  const tail = ranked.slice(rows - 1);
  const tailAmount = tail.reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0));

  return {
    entries: [
      ...kept,
      {
        key: "others",
        label: `Autres (${tail.length} catégorie${tail.length > 1 ? "s" : ""})`,
        amount: tailAmount,
        share: shareOf(tailAmount, total),
      },
    ],
    total,
  };
}

/** Share of a total, guarded: a zero total has no shares rather than NaN. */
function shareOf(amount: Decimal, total: Decimal): number {
  if (total.isZero()) {
    return 0;
  }

  return amount.dividedBy(total).toNumber();
}
