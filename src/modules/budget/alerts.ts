import Decimal from "decimal.js";
import { toDateOnlyString } from "@/lib/dates";
import type { Currency } from "@/lib/money";
import type { AlertCandidate, AlertRuleConfig } from "@/modules/alerts/domain";
import {
  budgetOverrunFingerprint,
  lowBalanceFingerprint,
  unusualExpenseFingerprint,
} from "@/modules/alerts/domain";
import type { TransactionRecord } from "./domain";
import type { BudgetReportRow } from "./report";

/**
 * Budget-side alert rules (BP-05): low balance, budget overrun, unusual expense.
 *
 * Each function is pure — inputs in, candidates out, no clock hidden inside — so the
 * whole rule set is unit-tested with fixed dates. Two principles run through all three:
 *
 * - **missing data is not a zero**: an account with no recorded transaction, or a month
 *   whose transactions could not be read in full, produces no alert at all;
 * - **the rules reuse the reporting definitions**: the overrun reads the same rows as the
 *   Suivi tab (`buildBudgetReport`), so an alert and the table can never disagree.
 */

export type AccountBalance = {
  accountId: string;
  accountName: string;
  currency: Currency;
  /** How many transactions the account holds; zero means the balance is unknown. */
  transactionCount: number;
  balance: Decimal;
};

/**
 * Low balance: the recorded balance of an account sits below the configured floor.
 *
 * An account with no recorded transaction is **not** at zero — its balance is unknown —
 * so it is left out. A threshold of zero applies to every currency (zero means the same
 * everywhere) and flags overdrawn accounts; a positive threshold only compares accounts
 * in its own currency, because the app never converts.
 */
export function evaluateLowBalance(
  accounts: readonly AccountBalance[],
  rule: AlertRuleConfig,
): AlertCandidate[] {
  if (!rule.enabled) {
    return [];
  }

  const threshold = rule.thresholdAmount ?? new Decimal(0);
  const candidates: AlertCandidate[] = [];

  for (const account of accounts) {
    if (account.transactionCount === 0) {
      continue;
    }

    if (
      threshold.greaterThan(0) &&
      rule.thresholdCurrency !== null &&
      account.currency !== rule.thresholdCurrency
    ) {
      continue;
    }

    if (account.balance.lessThan(threshold)) {
      candidates.push({
        kind: "LOW_BALANCE",
        fingerprint: lowBalanceFingerprint(account.accountId),
        inputs: {
          accountId: account.accountId,
          accountName: account.accountName,
          currency: account.currency,
          balance: account.balance.toFixed(2),
          threshold: threshold.toFixed(2),
        },
      });
    }
  }

  return candidates;
}

/**
 * Budget overrun: a spending envelope is exceeded for the month being evaluated.
 *
 * Input rows are the Suivi tab's own rows (`buildBudgetReport`), so refunds, transfers
 * and uncategorised lines are treated exactly as the Follow-up table treats them. Only
 * expense rows can be exceeded — an income target that falls short is not an overrun.
 *
 * The margin is a percentage of the planned amount: the alert appears once the overrun
 * reaches it (zero means "any overrun", its default). When the month's transactions were
 * only read in part, the actual could be understated — nothing is emitted rather than a
 * false confirmed anomaly.
 */
export function evaluateBudgetOverrun(
  rows: readonly BudgetReportRow[],
  rule: AlertRuleConfig,
  options: { monthKey: string; truncated?: boolean },
): AlertCandidate[] {
  if (!rule.enabled || options.truncated) {
    return [];
  }

  const margin = rule.thresholdPercent ?? new Decimal(0);
  const candidates: AlertCandidate[] = [];

  for (const row of rows) {
    if (row.categoryKind !== "EXPENSE") {
      continue;
    }

    const overrun = row.actual.minus(row.planned);
    if (!overrun.greaterThan(0)) {
      continue;
    }

    // `planned` is strictly positive by the budget contract; the guard is here so a
    // hand-edited row can never produce a division by zero. The margin is compared on
    // the exact percentage; the stored one is merely rounded for display.
    const exactPercent = row.planned.greaterThan(0)
      ? overrun.dividedBy(row.planned).times(100)
      : new Decimal(0);
    const percent = exactPercent.toDecimalPlaces(1, Decimal.ROUND_HALF_UP);

    if (exactPercent.lessThan(margin)) {
      continue;
    }

    candidates.push({
      kind: "BUDGET_OVERRUN",
      fingerprint: budgetOverrunFingerprint(row.categoryId, row.currency, options.monthKey),
      inputs: {
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        currency: row.currency,
        month: options.monthKey,
        planned: row.planned.toFixed(2),
        actual: row.actual.toFixed(2),
        overrun: overrun.toFixed(2),
        overrunPercent: percent.toFixed(1),
      },
    });
  }

  return candidates;
}

/**
 * Unusual expense: a single expense of the month reaches or exceeds the threshold.
 *
 * A deterministic amount threshold, not a statistical heuristic (out of scope for this
 * pass). Only genuine one-off spending is watched: transactions carrying an
 * `externalRef` come from a machine path (a confirmed prévision, the salary booking)
 * and are expected by construction, so they are excluded. The threshold always has a
 * currency, and only expenses in that currency are compared — no conversion.
 *
 * `truncated` plays the same role as above: a partial month read could hide an expense
 * rather than prove its absence, and it could equally under-report; the rule stays quiet.
 */
export function evaluateUnusualExpense(
  transactions: readonly TransactionRecord[],
  rule: AlertRuleConfig,
  options: { truncated?: boolean } = {},
): AlertCandidate[] {
  const threshold = rule.thresholdAmount;

  if (
    !rule.enabled ||
    options.truncated ||
    threshold === null ||
    !threshold.greaterThan(0) ||
    rule.thresholdCurrency === null
  ) {
    return [];
  }

  const candidates: AlertCandidate[] = [];

  for (const transaction of transactions) {
    if (transaction.type !== "EXPENSE" || transaction.externalRef !== null) {
      continue;
    }

    if (transaction.currency !== rule.thresholdCurrency) {
      continue;
    }

    const magnitude = transaction.amount.abs();
    if (magnitude.lessThan(threshold)) {
      continue;
    }

    candidates.push({
      kind: "UNUSUAL_EXPENSE",
      fingerprint: unusualExpenseFingerprint(transaction.id),
      inputs: {
        transactionId: transaction.id,
        label: transaction.label,
        amount: magnitude.toFixed(2),
        currency: transaction.currency,
        date: toDateOnlyString(transaction.operationDate),
        accountName: transaction.accountName ?? "",
        threshold: threshold.toFixed(2),
      },
    });
  }

  return candidates;
}
