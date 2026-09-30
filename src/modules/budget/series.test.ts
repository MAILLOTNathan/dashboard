import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { TransactionRecord, TransactionType } from "./domain";
import { buildCategoryBreakdown, buildMonthlySeries, UNCATEGORISED_LABEL } from "./series";

/**
 * Fictitious transactions only. Dates are calendar days at UTC midnight, like every
 * operation date in the project.
 */
function transaction(overrides: {
  id?: string;
  type?: TransactionType;
  amount: string;
  operationDate: string;
  categoryId?: string | null;
  categoryName?: string | null;
  currency?: TransactionRecord["currency"];
}): TransactionRecord {
  return {
    id: overrides.id ?? `tx-${overrides.operationDate}-${overrides.amount}`,
    type: overrides.type ?? "EXPENSE",
    amount: new Decimal(overrides.amount),
    currency: overrides.currency ?? "EUR",
    operationDate: new Date(`${overrides.operationDate}T00:00:00.000Z`),
    label: "Ligne de test",
    accountId: "account-1",
    accountName: "Compte courant",
    categoryId: overrides.categoryId ?? null,
    categoryName: overrides.categoryName ?? null,
    notes: null,
    externalRef: null,
  };
}

describe("buildMonthlySeries", () => {
  const monthKeys = ["2026-08", "2026-09"];

  it("returns a point per requested month, zeros included", () => {
    const series = buildMonthlySeries([], monthKeys);

    expect(series.map((point) => point.monthKey)).toEqual(monthKeys);
    // A month with nothing recorded is a zero, not a missing bar.
    expect(series[0].totals.income.toFixed(2)).toBe("0.00");
    expect(series[0].totals.transactionCount).toBe(0);
  });

  it("buckets each transaction into its own month", () => {
    const series = buildMonthlySeries(
      [
        transaction({ amount: "900.00", operationDate: "2026-08-03", type: "INCOME" }),
        transaction({ amount: "-120.00", operationDate: "2026-09-10" }),
      ],
      monthKeys,
    );

    expect(series[0].totals.income.toFixed(2)).toBe("900.00");
    expect(series[0].totals.expenses.toFixed(2)).toBe("0.00");
    expect(series[1].totals.expenses.toFixed(2)).toBe("120.00");
  });

  it("keeps the end-of-month bound exclusive", () => {
    // The 1st of the next month belongs to the next month, never to this one.
    const series = buildMonthlySeries(
      [transaction({ amount: "-50.00", operationDate: "2026-10-01" })],
      ["2026-09"],
    );

    expect(series[0].totals.transactionCount).toBe(0);
  });

  it("excludes transfers from income and expenses, as the monthly totals do", () => {
    const series = buildMonthlySeries(
      [
        transaction({ amount: "-300.00", operationDate: "2026-09-04", type: "TRANSFER" }),
        transaction({ amount: "-10.00", operationDate: "2026-09-05" }),
      ],
      ["2026-09"],
    );

    expect(series[0].totals.transfers.toFixed(2)).toBe("300.00");
    expect(series[0].totals.expenses.toFixed(2)).toBe("10.00");
    expect(series[0].totals.net.toFixed(2)).toBe("-10.00");
  });

  it("lets a refund reduce the expenses of its month", () => {
    const series = buildMonthlySeries(
      [
        transaction({ amount: "-200.00", operationDate: "2026-09-06" }),
        transaction({ amount: "50.00", operationDate: "2026-09-20" }),
      ],
      ["2026-09"],
    );

    expect(series[0].totals.expenses.toFixed(2)).toBe("150.00");
  });
});

describe("buildCategoryBreakdown", () => {
  it("adds up the expenses per category, largest first", () => {
    const breakdown = buildCategoryBreakdown(
      [
        transaction({
          amount: "-40.00",
          operationDate: "2026-09-02",
          categoryId: "cat-food",
          categoryName: "Courses",
        }),
        transaction({
          amount: "-60.00",
          operationDate: "2026-09-03",
          categoryId: "cat-home",
          categoryName: "Logement",
        }),
        transaction({
          amount: "-10.00",
          operationDate: "2026-09-04",
          categoryId: "cat-food",
          categoryName: "Courses",
        }),
      ],
      { kind: "EXPENSE" },
    );

    expect(breakdown.total.toFixed(2)).toBe("110.00");
    expect(breakdown.entries.map((entry) => entry.label)).toEqual(["Logement", "Courses"]);
    expect(breakdown.entries[1].amount.toFixed(2)).toBe("50.00");
    // Shares are computed against the total, so the bars can be checked by hand.
    expect(breakdown.entries[0].share).toBeCloseTo(60 / 110, 5);
  });

  it("keeps uncategorised spending as its own line instead of dropping it", () => {
    const breakdown = buildCategoryBreakdown(
      [
        transaction({ amount: "-30.00", operationDate: "2026-09-02" }),
        transaction({
          amount: "-20.00",
          operationDate: "2026-09-03",
          categoryId: "cat-food",
          categoryName: "Courses",
        }),
      ],
      { kind: "EXPENSE" },
    );

    const total = breakdown.entries.reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0));
    expect(total.toFixed(2)).toBe("50.00");
    expect(breakdown.entries.find((entry) => entry.label === UNCATEGORISED_LABEL)?.amount.toFixed(2)).toBe(
      "30.00",
    );
  });

  it("lets a refund reduce its category, even below zero", () => {
    const breakdown = buildCategoryBreakdown(
      [
        transaction({
          amount: "-100.00",
          operationDate: "2026-09-02",
          categoryId: "cat-home",
          categoryName: "Logement",
        }),
        transaction({
          amount: "150.00",
          operationDate: "2026-09-09",
          categoryId: "cat-home",
          categoryName: "Logement",
        }),
      ],
      { kind: "EXPENSE" },
    );

    expect(breakdown.entries[0].amount.toFixed(2)).toBe("-50.00");
  });

  it("ignores the other kind of transaction", () => {
    const breakdown = buildCategoryBreakdown(
      [
        transaction({ amount: "900.00", operationDate: "2026-09-01", type: "INCOME" }),
        transaction({ amount: "-20.00", operationDate: "2026-09-02" }),
      ],
      { kind: "EXPENSE" },
    );

    expect(breakdown.total.toFixed(2)).toBe("20.00");
  });

  it("reports shares of zero rather than NaN when the total is zero", () => {
    const breakdown = buildCategoryBreakdown(
      [
        transaction({ amount: "-40.00", operationDate: "2026-09-02", categoryId: "c", categoryName: "C" }),
        transaction({ amount: "40.00", operationDate: "2026-09-03", categoryId: "c", categoryName: "C" }),
      ],
      { kind: "EXPENSE" },
    );

    expect(breakdown.total.toFixed(2)).toBe("0.00");
    expect(breakdown.entries[0].share).toBe(0);
  });

  it("merges the smallest categories into a single line, keeping the total exact", () => {
    const breakdown = buildCategoryBreakdown(
      [
        transaction({ amount: "-100.00", operationDate: "2026-09-01", categoryId: "c1", categoryName: "Un" }),
        transaction({ amount: "-10.00", operationDate: "2026-09-02", categoryId: "c2", categoryName: "Deux" }),
        transaction({ amount: "-5.00", operationDate: "2026-09-03", categoryId: "c3", categoryName: "Trois" }),
      ],
      { kind: "EXPENSE", limit: 2 },
    );

    expect(breakdown.entries).toHaveLength(2);
    expect(breakdown.entries[1]).toMatchObject({ key: "others", label: "Autres (2 catégories)" });
    expect(breakdown.entries[1].amount.toFixed(2)).toBe("15.00");
    expect(breakdown.total.toFixed(2)).toBe("115.00");
  });

  it("counts income by origin when asked", () => {
    const breakdown = buildCategoryBreakdown(
      [
        transaction({
          amount: "900.00",
          operationDate: "2026-09-01",
          type: "INCOME",
          categoryId: "cat-rent",
          categoryName: "Loyer",
        }),
        transaction({
          amount: "100.00",
          operationDate: "2026-09-02",
          type: "INCOME",
          categoryId: "cat-refund",
          categoryName: "Remboursements",
        }),
        transaction({ amount: "-30.00", operationDate: "2026-09-03" }),
      ],
      { kind: "INCOME" },
    );

    expect(breakdown.total.toFixed(2)).toBe("1000.00");
    expect(breakdown.entries.map((entry) => entry.label)).toEqual(["Loyer", "Remboursements"]);
  });

  it("returns nothing to distribute for an empty month", () => {
    const breakdown = buildCategoryBreakdown([], { kind: "EXPENSE" });

    expect(breakdown.entries).toEqual([]);
    expect(breakdown.total.toFixed(2)).toBe("0.00");
  });
});
