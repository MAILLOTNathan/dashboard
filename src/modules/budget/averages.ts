import Decimal from "decimal.js";
import type { Currency } from "@/lib/money";
import type { CategoryKind, TransactionRecord } from "./domain";

/**
 * Rolling per-category averages, used to suggest budget amounts (display only).
 *
 * The definition, in one place:
 * - The window is the caller's choice (the Budgets tab uses the three months before the
 *   displayed one) and `monthCount` is its **fixed** length: the average is
 *   `total ÷ monthCount`, empty months included, because "what does this category cost
 *   per month" is the question a budget answers.
 * - Expenses count as a positive magnitude (a refund reduces its category, exactly like
 *   the Suivi tab); income counts as received. Currencies are never converted, and a
 *   category is averaged **per currency**.
 * - Transfers have no category by design and uncategorised rows have no key to attach
 *   to, so both are skipped.
 * - `activeMonths` says how many months of the window actually hold rows, so a figure
 *   built on one busy month is not mistaken for a habit.
 */

export const AVERAGE_WINDOW_MONTHS = 3;

export type CategoryAverage = {
  categoryId: string;
  categoryName: string;
  kind: CategoryKind;
  currency: Currency;
  /** Months of the window holding at least one row for this category and currency. */
  activeMonths: number;
  /** Actual total across the window: expenses positive, income as received. */
  total: Decimal;
  /** total ÷ monthCount, rounded to the cent (half-up). */
  monthlyAverage: Decimal;
};

export function computeCategoryAverages(
  transactions: readonly TransactionRecord[],
  options: { monthCount: number },
): CategoryAverage[] {
  if (!Number.isInteger(options.monthCount) || options.monthCount < 1) {
    throw new RangeError(`Invalid month count: ${options.monthCount}`);
  }

  type Bucket = {
    categoryId: string;
    categoryName: string;
    kind: CategoryKind;
    currency: Currency;
    total: Decimal;
    months: Set<string>;
  };

  const buckets = new Map<string, Bucket>();

  for (const transaction of transactions) {
    if (transaction.type === "TRANSFER" || transaction.categoryId === null) {
      continue;
    }

    const kind: CategoryKind = transaction.type === "INCOME" ? "INCOME" : "EXPENSE";
    const key = `${transaction.categoryId}|${transaction.currency}`;
    let bucket = buckets.get(key);

    if (!bucket) {
      bucket = {
        categoryId: transaction.categoryId,
        categoryName: transaction.categoryName ?? "",
        kind,
        currency: transaction.currency,
        total: new Decimal(0),
        months: new Set(),
      };
      buckets.set(key, bucket);
    }

    bucket.total = bucket.total.plus(
      kind === "EXPENSE" ? transaction.amount.negated() : transaction.amount,
    );
    bucket.months.add(transaction.operationDate.toISOString().slice(0, 7));
  }

  return [...buckets.values()]
    .map((bucket) => ({
      categoryId: bucket.categoryId,
      categoryName: bucket.categoryName,
      kind: bucket.kind,
      currency: bucket.currency,
      activeMonths: bucket.months.size,
      total: bucket.total,
      monthlyAverage: bucket.total
        .dividedBy(options.monthCount)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    }))
    .sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "EXPENSE" ? -1 : 1;
      }
      return a.categoryName.localeCompare(b.categoryName, "fr");
    });
}
