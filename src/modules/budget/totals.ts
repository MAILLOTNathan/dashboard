import Decimal from "decimal.js";
import type { Currency } from "@/lib/money";
import type { TransactionRecord } from "./domain";

/**
 * Monthly aggregation of transactions.
 *
 * Definitions (documented because an undocumented indicator is not verifiable):
 *
 * - `income`   : sum of the amounts of INCOME transactions. A negative amount on
 *                an INCOME transaction is a correction and reduces the income.
 * - `expenses` : negated sum of the amounts of EXPENSE transactions. Expenses are
 *                therefore reported as a positive number. A positive amount on an
 *                EXPENSE transaction is a reimbursement and reduces the expenses;
 *                a month with more reimbursements than expenses legitimately
 *                reports a negative `expenses`.
 * - `transfers`: absolute volume of TRANSFER transactions. Moving money between
 *                two accounts is not income and not an expense, so transfers are
 *                **excluded** from `income`, from `expenses` and from `net`.
 *                They are reported separately so the volume stays visible.
 * - `net`      : `income - expenses`. Transfers never contribute to it.
 * - An empty month returns zeros, not a missing value: the caller distinguishes
 *   "no data" from "not connected" with the connection state, not with this number.
 *
 * A single currency is aggregated at a time: mixing currencies would produce a
 * meaningless total, so the caller groups by currency first.
 */
export type MonthlyTotals = {
  currency: Currency;
  transactionCount: number;
  income: Decimal;
  expenses: Decimal;
  transfers: Decimal;
  net: Decimal;
};

export function computeMonthlyTotals(
  transactions: readonly TransactionRecord[],
  options: { currency?: Currency } = {},
): MonthlyTotals {
  const currency = options.currency ?? transactions[0]?.currency ?? "EUR";

  let income = new Decimal(0);
  let expenses = new Decimal(0);
  let transfers = new Decimal(0);

  for (const transaction of transactions) {
    if (transaction.currency !== currency) {
      throw new Error(
        `Cannot aggregate ${transaction.currency} and ${currency} in a single total: group transactions by currency first.`,
      );
    }

    switch (transaction.type) {
      case "INCOME":
        income = income.plus(transaction.amount);
        break;
      case "EXPENSE":
        expenses = expenses.plus(transaction.amount.negated());
        break;
      case "TRANSFER":
        transfers = transfers.plus(transaction.amount.abs());
        break;
    }
  }

  return {
    currency,
    transactionCount: transactions.length,
    income,
    expenses,
    transfers,
    net: income.minus(expenses),
  };
}

/** Groups transactions by currency, the only safe unit for a total. */
export function groupByCurrency(
  transactions: readonly TransactionRecord[],
): Map<Currency, TransactionRecord[]> {
  const groups = new Map<Currency, TransactionRecord[]>();

  for (const transaction of transactions) {
    const group = groups.get(transaction.currency);
    if (group) {
      group.push(transaction);
    } else {
      groups.set(transaction.currency, [transaction]);
    }
  }

  return groups;
}

/** Totals per currency, so a multi-currency month is never summed into one number. */
export function computeTotalsByCurrency(
  transactions: readonly TransactionRecord[],
): MonthlyTotals[] {
  return [...groupTransactionsByCurrency(transactions).values()].map((group) =>
    computeMonthlyTotals(group),
  );
}

/**
 * Groups transactions by their currency.
 *
 * Exported because every aggregation must obey the same rule: a total is always
 * computed for one currency, never across two (see `computeMonthlyTotals`).
 */
export function groupTransactionsByCurrency(
  transactions: readonly TransactionRecord[],
): Map<Currency, TransactionRecord[]> {
  return groupByCurrency(transactions);
}
