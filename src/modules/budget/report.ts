import Decimal from "decimal.js";
import type { Currency } from "@/lib/money";
import type { BudgetRecord, CategoryKind, TransactionRecord } from "./domain";

/**
 * Budget follow-up: planned versus actual for one month, per category and currency.
 *
 * Definitions (also documented in `docs/architecture/overview.md` — an undocumented
 * indicator is not verifiable):
 *
 * - `planned` — the budget amount, a positive magnitude whatever the category's kind.
 * - `actual` — transactions **dated in the month** (operation date, exclusive upper
 *   bound like every monthly read), attached to the category and carrying the row's
 *   currency. The sign convention of `computeMonthlyTotals` is reused: an `EXPENSE` is
 *   reported positive, an `INCOME` positive, so both read in the direction of the plan.
 *   A refund (a positive amount on an `EXPENSE`) therefore reduces the actual, and
 *   refunds exceeding the spending legitimately produce a **negative actual**. Transfers
 *   carry no category by design and never appear; uncategorised transactions are ignored.
 * - `remaining` — `planned - actual`. Negative means the plan was exceeded.
 * - `totals` — every row of one currency and one kind added up (`summariseBudgetReport`):
 *   one total for the month's spending envelopes, one for its income goals. Kinds are
 *   never mixed and no total crosses currencies.
 * - A month without transactions keeps its budget rows with a zero actual.
 *
 * Currencies are never converted: a row is a (category, currency) pair, and a transaction
 * in another currency does not feed it.
 */

export type BudgetReportRow = {
  /** What identifies one row: the (category, currency) pair. */
  key: string;
  categoryId: string;
  categoryName: string;
  categoryKind: CategoryKind;
  currency: Currency;
  planned: Decimal;
  actual: Decimal;
  remaining: Decimal;
};

export type BudgetVarianceTone = "positive" | "negative" | "warning";

/**
 * One row per budget, in the order given (the repository already sorts by currency then
 * category name), with the month's actual folded in from the transactions.
 */
export function buildBudgetReport(
  budgets: readonly BudgetRecord[],
  transactions: readonly TransactionRecord[],
): BudgetReportRow[] {
  const actuals = new Map<string, Decimal>();

  for (const transaction of transactions) {
    // Transfers have no category by design, and an uncategorised line belongs to no
    // budget: both stay out of the report.
    if (transaction.type === "TRANSFER" || transaction.categoryId === null) {
      continue;
    }

    const key = `${transaction.categoryId}|${transaction.currency}`;
    const contribution =
      transaction.type === "EXPENSE" ? transaction.amount.negated() : transaction.amount;
    actuals.set(key, (actuals.get(key) ?? new Decimal(0)).plus(contribution));
  }

  return budgets.map((budget) => {
    const key = `${budget.categoryId}|${budget.currency}`;
    const actual = actuals.get(key) ?? new Decimal(0);

    return {
      key,
      categoryId: budget.categoryId,
      categoryName: budget.categoryName,
      categoryKind: budget.categoryKind,
      currency: budget.currency,
      planned: budget.amount,
      actual,
      remaining: budget.amount.minus(actual),
    };
  });
}

export type BudgetReportTotal = {
  currency: Currency;
  categoryKind: CategoryKind;
  planned: Decimal;
  actual: Decimal;
  remaining: Decimal;
};

/** Kind order inside one currency: the spending envelope first, then the income goal. */
const TOTAL_KIND_ORDER: CategoryKind[] = ["EXPENSE", "INCOME"];

/**
 * Totals of the report, one per (currency, kind) pair — the "total budget" of the month.
 *
 * The rows of a currency and a kind are added up; anything else is left alone. A spending
 * envelope and an income goal are never summed together (they do not read in the same
 * direction), and no total mixes two currencies. Empty in, empty out: a month without
 * budget has no total to show, which is not the same as a total of zero.
 */
export function summariseBudgetReport(
  rows: readonly BudgetReportRow[],
): BudgetReportTotal[] {
  const totals = new Map<string, BudgetReportTotal>();

  for (const row of rows) {
    const key = `${row.currency}|${row.categoryKind}`;
    const existing = totals.get(key);

    if (existing) {
      existing.planned = existing.planned.plus(row.planned);
      existing.actual = existing.actual.plus(row.actual);
      existing.remaining = existing.remaining.plus(row.remaining);
    } else {
      totals.set(key, {
        currency: row.currency,
        categoryKind: row.categoryKind,
        planned: row.planned,
        actual: row.actual,
        remaining: row.remaining,
      });
    }
  }

  return [...totals.values()].sort(
    (a, b) =>
      a.currency.localeCompare(b.currency) ||
      TOTAL_KIND_ORDER.indexOf(a.categoryKind) - TOTAL_KIND_ORDER.indexOf(b.categoryKind),
  );
}

/**
 * How a row reads, in French, for the badge next to it.
 *
 * Only the direction that matters for the category's kind is called out: a spending
 * budget can be exceeded, an income goal can be reached or missed. A remaining of zero
 * is a met plan in both directions.
 *
 * Strict comparisons on purpose: `isPositive()` is true for decimal.js zero (its sign is
 * +1), so "over zero" would read as a shortfall.
 */
export function describeBudgetVariance(
  row: Pick<BudgetReportRow, "categoryKind" | "remaining">,
): { label: string; tone: BudgetVarianceTone } {
  if (row.categoryKind === "EXPENSE") {
    return row.remaining.lessThan(0)
      ? { label: "Dépassé", tone: "negative" }
      : { label: "Dans le budget", tone: "positive" };
  }

  return row.remaining.greaterThan(0)
    ? { label: "Sous l'objectif", tone: "warning" }
    : { label: "Objectif atteint", tone: "positive" };
}
