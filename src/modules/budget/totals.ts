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
 * - `transfers`: absolute volume of TRANSFER transactions. It is a **subset**: those
 *                amounts are already part of `income` or of `expenses` (see below), never
 *                an extra figure to add on top of them.
 * - `net`      : `income - expenses`, transfers included.
 *
 * A transfer moves money for real, so it counts — by its sign. A negative TRANSFER is
 * money leaving and counts as an expense; a positive one is money arriving and counts as
 * income. Recording both legs of one internal transfer therefore leaves `net` unchanged
 * while showing up in both cards, and recording a single leg (money sent to savings, whose
 * destination is not tracked) lowers the balance — which is the intent. The absolute
 * volume equals the sum of what the transfers added to the two sides, so the `Transferts`
 * card reconciles with the cards next to it.
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
      case "TRANSFER": {
        // The side is decided by the sign, not by the type of the row: a transfer is a
        // real movement, so it lands in one of the two branches above. A zero transfer
        // changes no total and is only counted in the volume.
        transfers = transfers.plus(transaction.amount.abs());

        if (transaction.amount.isNegative()) {
          expenses = expenses.plus(transaction.amount.abs());
        } else if (transaction.amount.greaterThan(0)) {
          income = income.plus(transaction.amount);
        }
        break;
      }
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

export function computeCumulativeTotal(
  transactions: readonly TransactionRecord[],
  options: { currency?: Currency } = {},
): Decimal {
  const currency = options.currency ?? transactions[0]?.currency ?? "EUR";

  let cumulativeTotal = new Decimal(0);
  for (const transaction of transactions) {
    if (transaction.currency !== currency) {
      throw new Error(
        `Cannot aggregate ${transaction.currency} and ${currency} in a single total: group transactions by currency first.`,
      );
    }
    cumulativeTotal = cumulativeTotal.plus(transaction.amount);
  }

  return cumulativeTotal;
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
