import Decimal from "decimal.js";
import { currentMonthKey, parseMonthKey } from "@/lib/dates";
import { DEFAULT_CURRENCY, type Currency } from "@/lib/money";
import {
  occurrenceDatesForMonth,
  type RecurringEntryRecord,
} from "./recurrence";

/**
 * Recommended savings threshold: the cushion a savings account should hold.
 *
 * The rule is deliberately simple and deterministic: **six months of expected
 * expenses**, taken from the recurring definitions (`RecurringEntry`, the Prévisions
 * tab) — the same planned magnitudes the forecasts display, never a statistical
 * average. Nothing is stored: the figure is recomputed from the series on every page,
 * so it follows reality the moment a series changes.
 *
 * Conventions, also documented in `docs/architecture/overview.md`:
 *
 * - the window is the **current month and the five following ones**: the money must
 *   cover what is still ahead, including the month being lived through;
 * - each occurrence is the series' day of month, clamped to shorter months, ignored
 *   before the series starts and after it ends — exactly `occurrenceDatesForMonth`,
 *   the function the forecasts use;
 * - currencies are never mixed: one threshold per currency, computed from the series
 *   whose account carries that currency (an unknown account falls back to the default
 *   one, like the Prévisions tab);
 * - an unrecorded savings balance is **unknown**, never zero: a savings account with
 *   no operation reads "unknown" and no progress is shown rather than a fake 0 %.
 */

/** How many months of expected expenses the cushion must cover. */
export const SAVINGS_THRESHOLD_MONTHS = 6;

export type SavingsMonth = {
  monthKey: string;
  /** Expected expenses of that month, positive magnitude, in the row's currency. */
  amount: Decimal;
};

export type SavingsAccount = {
  accountId: string;
  accountName: string;
  currency: Currency;
  /** How many transactions the account recorded; zero means the balance is unknown. */
  transactionCount: number;
  balance: Decimal;
};

export type SavingsThreshold = {
  currency: Currency;
  months: SavingsMonth[];
  /** Six months of expected expenses added up. */
  expectedTotal: Decimal;
  /** Distinct expense series occurring in the window, for this currency. */
  seriesCount: number;
  savingsAccountCount: number;
  recordedAccountCount: number;
  /** Recorded savings balance; null when no savings account has anything recorded. */
  savingsBalance: Decimal | null;
  /** balance ÷ threshold × 100, one decimal, half-up; null when the balance is unknown. */
  progress: Decimal | null;
  /** threshold − balance, negative when the cushion exceeds the threshold; null when unknown. */
  shortfall: Decimal | null;
  /**
   * How many months of expected expenses the recorded balance covers, one decimal,
   * half-up. `balance × 6 ÷ threshold`, so "6,0" means the full cushion is there. A
   * non-positive balance reads 0 — the debt is told by the amount. Null when the
   * balance is unknown.
   */
  runwayMonths: Decimal | null;
};

/**
 * The window: `SAVINGS_THRESHOLD_MONTHS` calendar months starting with the current one.
 * Every month is counted whole, whatever the day of the month.
 */
export function savingsWindow(now: Date = new Date()): string[] {
  const { year, month } = parseMonthKey(currentMonthKey(now));

  return Array.from({ length: SAVINGS_THRESHOLD_MONTHS }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/** Expected expenses of one month, per currency, with the series that contribute. */
function expectedExpensesForMonth(
  entries: readonly RecurringEntryRecord[],
  currencyByAccount: ReadonlyMap<string, Currency>,
  monthKey: string,
): Map<Currency, { amount: Decimal; series: Set<string> }> {
  const { year, month } = parseMonthKey(monthKey);
  const perCurrency = new Map<Currency, { amount: Decimal; series: Set<string> }>();

  for (const entry of entries) {
    if (entry.type !== "EXPENSE") {
      continue;
    }

    const dates = occurrenceDatesForMonth(entry, year, month);
    if (dates.length === 0) {
      continue;
    }

    const currency = currencyByAccount.get(entry.accountId) ?? DEFAULT_CURRENCY;
    const bucket = perCurrency.get(currency) ?? { amount: new Decimal(0), series: new Set() };
    bucket.amount = bucket.amount.plus(entry.amount.times(dates.length));
    bucket.series.add(entry.id);
    perCurrency.set(currency, bucket);
  }

  return perCurrency;
}

/**
 * The recommended thresholds, one row per currency that carries an expected expense in
 * the window, sorted by currency. Empty in, empty out: with no expense series there is
 * no threshold to show — not a threshold of zero.
 */
export function buildSavingsThresholds(input: {
  entries: readonly RecurringEntryRecord[];
  /** Account id → currency, the way the Prévisions tab resolves a series' currency. */
  currencyByAccount: ReadonlyMap<string, Currency>;
  /** The owner's savings accounts, balances resolved (`null` never reaches here). */
  savingsAccounts: readonly SavingsAccount[];
  months: readonly string[];
}): SavingsThreshold[] {
  const perMonth = new Map<string, Map<Currency, { amount: Decimal; series: Set<string> }>>();
  const currencies = new Set<Currency>();

  for (const monthKey of input.months) {
    const expected = expectedExpensesForMonth(input.entries, input.currencyByAccount, monthKey);
    perMonth.set(monthKey, expected);
    for (const [currency, bucket] of expected) {
      if (bucket.amount.greaterThan(0)) {
        currencies.add(currency);
      }
    }
  }

  return [...currencies].sort((a, b) => a.localeCompare(b)).map((currency) => {
    const months: SavingsMonth[] = input.months.map((monthKey) => ({
      monthKey,
      amount: perMonth.get(monthKey)?.get(currency)?.amount ?? new Decimal(0),
    }));

    const expectedTotal = months.reduce(
      (total, month) => total.plus(month.amount),
      new Decimal(0),
    );

    const series = new Set<string>();
    for (const monthKey of input.months) {
      for (const id of perMonth.get(monthKey)?.get(currency)?.series ?? []) {
        series.add(id);
      }
    }

    const accounts = input.savingsAccounts.filter((account) => account.currency === currency);
    const recorded = accounts.filter((account) => account.transactionCount > 0);

    // No recorded transaction means no recorded balance: unknown, not zero.
    const savingsBalance =
      recorded.length === 0
        ? null
        : recorded.reduce((total, account) => total.plus(account.balance), new Decimal(0));

    const progress =
      savingsBalance === null
        ? null
        : savingsBalance.lessThanOrEqualTo(0)
          ? new Decimal(0)
          : savingsBalance
              .dividedBy(expectedTotal)
              .times(100)
              .toDecimalPlaces(1, Decimal.ROUND_HALF_UP);

    const runwayMonths =
      savingsBalance === null
        ? null
        : savingsBalance.lessThanOrEqualTo(0)
          ? new Decimal(0)
          : savingsBalance
              .times(SAVINGS_THRESHOLD_MONTHS)
              .dividedBy(expectedTotal)
              .toDecimalPlaces(1, Decimal.ROUND_HALF_UP);

    return {
      currency,
      months,
      expectedTotal,
      seriesCount: series.size,
      savingsAccountCount: accounts.length,
      recordedAccountCount: recorded.length,
      savingsBalance,
      progress,
      shortfall: savingsBalance === null ? null : expectedTotal.minus(savingsBalance),
      runwayMonths,
    } satisfies SavingsThreshold;
  });
}
