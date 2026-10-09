import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { BudgetRecord, TransactionRecord } from "./domain";
import { buildBudgetReport, describeBudgetVariance, summariseBudgetReport } from "./report";
import { computeMonthlyTotals } from "./totals";

/** Fictitious values only. */

let sequence = 0;

function budget(
  overrides: Partial<BudgetRecord> & Pick<BudgetRecord, "categoryId" | "amount">,
): BudgetRecord {
  sequence += 1;

  return {
    id: `budget-${sequence}`,
    categoryName: "Courses",
    categoryKind: "EXPENSE",
    year: 2026,
    month: 10,
    currency: "EUR",
    ...overrides,
  };
}

function transaction(
  overrides: Partial<TransactionRecord> & Pick<TransactionRecord, "amount">,
): TransactionRecord {
  sequence += 1;

  return {
    id: `tx-${sequence}`,
    type: "EXPENSE",
    currency: "EUR",
    operationDate: new Date("2026-10-05T00:00:00.000Z"),
    label: "Ligne de test",
    accountId: "account-1",
    accountName: "Compte courant",
    categoryId: "category-1",
    categoryName: "Courses",
    notes: null,
    externalRef: null,
    transferGroupId: null,
    reconciledAt: null,
    createdAt: new Date("2026-10-05T00:00:00.000Z"),
    ...overrides,
  };
}

describe("buildBudgetReport", () => {
  it("reports an exact match as a met spending budget", () => {
    const [row] = buildBudgetReport(
      [budget({ categoryId: "category-1", amount: new Decimal("300") })],
      [transaction({ amount: new Decimal("-300") })],
    );

    expect(row?.planned.toFixed(2)).toBe("300.00");
    expect(row?.actual.toFixed(2)).toBe("300.00");
    expect(row?.remaining.toFixed(2)).toBe("0.00");
    expect(describeBudgetVariance(row!)).toEqual({
      label: "Dans le budget",
      tone: "positive",
    });
  });

  it("flags an over-budget category with a negative remaining", () => {
    const [row] = buildBudgetReport(
      [budget({ categoryId: "category-1", amount: new Decimal("300") })],
      [transaction({ amount: new Decimal("-350") })],
    );

    expect(row?.actual.toFixed(2)).toBe("350.00");
    expect(row?.remaining.toFixed(2)).toBe("-50.00");
    expect(describeBudgetVariance(row!)).toEqual({ label: "Dépassé", tone: "negative" });
  });

  it("lets a refund reduce the actual of its category", () => {
    const [row] = buildBudgetReport(
      [budget({ categoryId: "category-1", amount: new Decimal("300") })],
      [
        transaction({ amount: new Decimal("-200") }),
        // A positive amount on an EXPENSE is a reimbursement.
        transaction({ amount: new Decimal("50") }),
      ],
    );

    expect(row?.actual.toFixed(2)).toBe("150.00");
    expect(row?.remaining.toFixed(2)).toBe("150.00");
  });

  it("keeps a negative actual when refunds exceed the spending", () => {
    const [row] = buildBudgetReport(
      [budget({ categoryId: "category-1", amount: new Decimal("300") })],
      [
        transaction({ amount: new Decimal("-100") }),
        transaction({ amount: new Decimal("120") }),
      ],
    );

    // Refunded more than spent: the actual is negative, and the budget is not exceeded.
    expect(row?.actual.toFixed(2)).toBe("-20.00");
    expect(row?.remaining.toFixed(2)).toBe("320.00");
    expect(describeBudgetVariance(row!).label).toBe("Dans le budget");
  });

  it("keeps the budget shown with a zero actual when the month has no transaction", () => {
    const [row] = buildBudgetReport(
      [budget({ categoryId: "category-1", amount: new Decimal("300") })],
      [],
    );

    expect(row?.actual.toFixed(2)).toBe("0.00");
    expect(row?.remaining.toFixed(2)).toBe("300.00");
  });

  it("keeps two currencies of the same category separate", () => {
    const rows = buildBudgetReport(
      [
        budget({ categoryId: "category-1", amount: new Decimal("300"), currency: "EUR" }),
        budget({ categoryId: "category-1", amount: new Decimal("200"), currency: "USD" }),
      ],
      [
        transaction({ amount: new Decimal("-100"), currency: "EUR" }),
        transaction({ amount: new Decimal("-50"), currency: "USD" }),
        // A third currency with no budget must not feed either row.
        transaction({ amount: new Decimal("-999"), currency: "GBP" }),
      ],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.currency).toBe("EUR");
    expect(rows[0]?.actual.toFixed(2)).toBe("100.00");
    expect(rows[1]?.currency).toBe("USD");
    expect(rows[1]?.actual.toFixed(2)).toBe("50.00");
  });

  it("ignores transfers and uncategorised transactions", () => {
    const [row] = buildBudgetReport(
      [budget({ categoryId: "category-1", amount: new Decimal("300") })],
      [
        transaction({ amount: new Decimal("-80") }),
        // A transfer carries no category by design; even a stray category must not count.
        transaction({ type: "TRANSFER", amount: new Decimal("-500"), categoryId: null }),
        transaction({ type: "TRANSFER", amount: new Decimal("-70"), categoryId: "category-1" }),
        transaction({ amount: new Decimal("-40"), categoryId: null }),
      ],
    );

    expect(row?.actual.toFixed(2)).toBe("80.00");
  });

  it("reads an income goal as reached or missed, never as over budget", () => {
    const incomeBudget = [
      budget({
        categoryId: "category-income",
        categoryName: "Salaire",
        categoryKind: "INCOME",
        amount: new Decimal("2500"),
      }),
    ];

    const [short] = buildBudgetReport(incomeBudget, [
      transaction({
        type: "INCOME",
        amount: new Decimal("2000"),
        categoryId: "category-income",
      }),
    ]);
    expect(short?.actual.toFixed(2)).toBe("2000.00");
    expect(short?.remaining.toFixed(2)).toBe("500.00");
    expect(describeBudgetVariance(short!)).toEqual({
      label: "Sous l'objectif",
      tone: "warning",
    });

    const [met] = buildBudgetReport(incomeBudget, [
      transaction({
        type: "INCOME",
        amount: new Decimal("2500"),
        categoryId: "category-income",
      }),
    ]);
    expect(met?.remaining.toFixed(2)).toBe("0.00");
    expect(describeBudgetVariance(met!).label).toBe("Objectif atteint");

    const [exceeded] = buildBudgetReport(incomeBudget, [
      transaction({
        type: "INCOME",
        amount: new Decimal("2700"),
        categoryId: "category-income",
      }),
    ]);
    expect(exceeded?.remaining.toFixed(2)).toBe("-200.00");
    // Exceeding an income goal is good news: still "atteint", never "dépassé".
    expect(describeBudgetVariance(exceeded!)).toEqual({
      label: "Objectif atteint",
      tone: "positive",
    });
  });

  it("reuses the monthly aggregation rules: figures equal computeMonthlyTotals", () => {
    const budgets = [
      budget({ categoryId: "category-1", amount: new Decimal("300") }),
      budget({ categoryId: "category-2", categoryName: "Loisirs", amount: new Decimal("100") }),
      budget({
        categoryId: "category-3",
        categoryName: "Salaire",
        categoryKind: "INCOME",
        amount: new Decimal("2500"),
      }),
    ];
    const transactions = [
      transaction({ amount: new Decimal("-350"), categoryId: "category-1" }),
      transaction({ amount: new Decimal("20"), categoryId: "category-1" }),
      transaction({ amount: new Decimal("-40"), categoryId: "category-2" }),
      transaction({
        type: "INCOME",
        amount: new Decimal("2000"),
        categoryId: "category-3",
      }),
    ];

    const rows = buildBudgetReport(budgets, transactions);
    const totals = computeMonthlyTotals(transactions, { currency: "EUR" });

    const sumOf = (kind: "EXPENSE" | "INCOME") =>
      rows
        .filter((row) => row.categoryKind === kind)
        .reduce((total, row) => total.plus(row.actual), new Decimal(0));

    expect(sumOf("EXPENSE").toFixed(2)).toBe(totals.expenses.toFixed(2));
    expect(sumOf("INCOME").toFixed(2)).toBe(totals.income.toFixed(2));
  });
});

describe("summariseBudgetReport", () => {
  it("adds up the rows of one currency and one kind into a single total", () => {
    const rows = buildBudgetReport(
      [
        budget({ categoryId: "category-1", amount: new Decimal("300") }),
        budget({
          categoryId: "category-2",
          categoryName: "Loisirs",
          amount: new Decimal("100"),
        }),
        budget({
          categoryId: "category-3",
          categoryName: "Salaire",
          categoryKind: "INCOME",
          amount: new Decimal("2500"),
        }),
      ],
      [
        transaction({ amount: new Decimal("-350"), categoryId: "category-1" }),
        transaction({ amount: new Decimal("-40"), categoryId: "category-2" }),
        transaction({
          type: "INCOME",
          amount: new Decimal("2000"),
          categoryId: "category-3",
        }),
      ],
    );

    const totals = summariseBudgetReport(rows);

    expect(totals).toHaveLength(2);
    // The spending envelope reads first, then the income goal.
    expect(totals[0]?.categoryKind).toBe("EXPENSE");
    expect(totals[0]?.planned.toFixed(2)).toBe("400.00");
    expect(totals[0]?.actual.toFixed(2)).toBe("390.00");
    expect(totals[0]?.remaining.toFixed(2)).toBe("10.00");
    expect(describeBudgetVariance(totals[0]!).label).toBe("Dans le budget");

    expect(totals[1]?.categoryKind).toBe("INCOME");
    expect(totals[1]?.planned.toFixed(2)).toBe("2500.00");
    expect(totals[1]?.actual.toFixed(2)).toBe("2000.00");
    expect(totals[1]?.remaining.toFixed(2)).toBe("500.00");
    expect(describeBudgetVariance(totals[1]!)).toEqual({
      label: "Sous l'objectif",
      tone: "warning",
    });
  });

  it("keeps currencies and kinds apart", () => {
    const rows = buildBudgetReport(
      [
        budget({ categoryId: "category-1", amount: new Decimal("300"), currency: "USD" }),
        budget({
          categoryId: "category-2",
          categoryName: "Loisirs",
          amount: new Decimal("200"),
          currency: "EUR",
        }),
        budget({
          categoryId: "category-3",
          categoryName: "Salaire",
          categoryKind: "INCOME",
          amount: new Decimal("1000"),
          currency: "EUR",
        }),
      ],
      [
        transaction({
          amount: new Decimal("-50"),
          currency: "USD",
          categoryId: "category-1",
        }),
        transaction({
          amount: new Decimal("-80"),
          currency: "EUR",
          categoryId: "category-2",
        }),
      ],
    );

    const totals = summariseBudgetReport(rows);

    // Sorted by currency, then expenses before income: EUR/EXPENSE, EUR/INCOME, USD/EXPENSE.
    expect(totals.map((total) => `${total.currency}|${total.categoryKind}`)).toEqual([
      "EUR|EXPENSE",
      "EUR|INCOME",
      "USD|EXPENSE",
    ]);
    expect(totals[0]?.actual.toFixed(2)).toBe("80.00");
    expect(totals[1]?.actual.toFixed(2)).toBe("0.00");
    expect(totals[2]?.actual.toFixed(2)).toBe("50.00");
    expect(totals[2]?.remaining.toFixed(2)).toBe("250.00");
  });

  it("flags an exceeded envelope at the total level", () => {
    const rows = buildBudgetReport(
      [
        budget({ categoryId: "category-1", amount: new Decimal("300") }),
        budget({
          categoryId: "category-2",
          categoryName: "Loisirs",
          amount: new Decimal("100"),
        }),
      ],
      [
        // Each category reads differently; the envelope is over budget as a whole.
        transaction({ amount: new Decimal("-200"), categoryId: "category-1" }),
        transaction({ amount: new Decimal("-250"), categoryId: "category-2" }),
      ],
    );

    const [total] = summariseBudgetReport(rows);

    expect(total?.planned.toFixed(2)).toBe("400.00");
    expect(total?.actual.toFixed(2)).toBe("450.00");
    expect(total?.remaining.toFixed(2)).toBe("-50.00");
    expect(describeBudgetVariance(total!)).toEqual({ label: "Dépassé", tone: "negative" });
  });

  it("carries the refunds of its rows, negative actual included", () => {
    const rows = buildBudgetReport(
      [budget({ categoryId: "category-1", amount: new Decimal("300") })],
      [
        transaction({ amount: new Decimal("-100") }),
        transaction({ amount: new Decimal("120") }),
      ],
    );

    const [total] = summariseBudgetReport(rows);

    expect(total?.actual.toFixed(2)).toBe("-20.00");
    expect(total?.remaining.toFixed(2)).toBe("320.00");
    expect(describeBudgetVariance(total!).label).toBe("Dans le budget");
  });

  it("returns no total for a month without budget", () => {
    expect(summariseBudgetReport(buildBudgetReport([], []))).toEqual([]);
  });
});
