import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { Currency } from "@/lib/money";
import type { TransactionRecord, TransactionType } from "./domain";
import { computeCategoryAverages } from "./averages";

/** Fictitious data only. */
function transaction(
  overrides: Omit<Partial<TransactionRecord>, "amount" | "type"> & {
    amount: string;
    type: TransactionType;
  },
): TransactionRecord {
  return {
    id: overrides.id ?? `tx-${Math.random()}`,
    type: overrides.type,
    amount: new Decimal(overrides.amount),
    currency: (overrides.currency ?? "EUR") as Currency,
    operationDate: overrides.operationDate ?? new Date(Date.UTC(2026, 8, 5)),
    label: overrides.label ?? "Opération de test",
    accountId: overrides.accountId ?? "account-1",
    accountName: overrides.accountName ?? null,
    categoryId: overrides.categoryId === undefined ? "category-1" : overrides.categoryId,
    categoryName: overrides.categoryName === undefined ? "Courses" : overrides.categoryName,
    notes: overrides.notes ?? null,
    externalRef: overrides.externalRef ?? null,
    transferGroupId: overrides.transferGroupId ?? null,
    reconciledAt: overrides.reconciledAt ?? null,
    createdAt: new Date(Date.UTC(2026, 8, 5)),
  };
}

describe("computeCategoryAverages", () => {
  it("averages expenses as a positive magnitude over the fixed window", () => {
    const [average] = computeCategoryAverages(
      [
        transaction({ type: "EXPENSE", amount: "-300", operationDate: new Date(Date.UTC(2026, 7, 5)) }),
        transaction({ type: "EXPENSE", amount: "-240", operationDate: new Date(Date.UTC(2026, 8, 5)) }),
      ],
      { monthCount: 3 },
    );

    // 540 over 3 months, empty months included: what the category costs per month.
    expect(average.total.toFixed(2)).toBe("540.00");
    expect(average.monthlyAverage.toFixed(2)).toBe("180.00");
    expect(average.activeMonths).toBe(2);
    expect(average.kind).toBe("EXPENSE");
  });

  it("lets a refund reduce its category, like the Suivi tab does", () => {
    const [average] = computeCategoryAverages(
      [
        transaction({ type: "EXPENSE", amount: "-300", operationDate: new Date(Date.UTC(2026, 8, 5)) }),
        transaction({ type: "EXPENSE", amount: "50", operationDate: new Date(Date.UTC(2026, 8, 20)) }),
      ],
      { monthCount: 1 },
    );

    expect(average.total.toFixed(2)).toBe("250.00");
    expect(average.monthlyAverage.toFixed(2)).toBe("250.00");
  });

  it("averages income as received", () => {
    const [average] = computeCategoryAverages(
      [transaction({ type: "INCOME", amount: "3000", categoryName: "Salaire" })],
      { monthCount: 3 },
    );

    expect(average.kind).toBe("INCOME");
    expect(average.monthlyAverage.toFixed(2)).toBe("1000.00");
  });

  it("skips transfers and uncategorised rows: there is no category to average", () => {
    const averages = computeCategoryAverages(
      [
        transaction({ type: "TRANSFER", amount: "-500", categoryId: null, categoryName: null }),
        transaction({ type: "EXPENSE", amount: "-80", categoryId: null, categoryName: null }),
      ],
      { monthCount: 3 },
    );

    expect(averages).toEqual([]);
  });

  it("keeps a category per currency apart", () => {
    const averages = computeCategoryAverages(
      [
        transaction({ type: "EXPENSE", amount: "-300", currency: "EUR" }),
        transaction({ type: "EXPENSE", amount: "-120", currency: "USD" }),
      ],
      { monthCount: 3 },
    );

    expect(averages).toHaveLength(2);
    expect(averages[0].currency).toBe("EUR");
    expect(averages[1].currency).toBe("USD");
  });

  it("rounds the average half-up on cents and sorts expenses first", () => {
    const averages = computeCategoryAverages(
      [
        transaction({ type: "INCOME", amount: "100", categoryId: "c2", categoryName: "Prime" }),
        transaction({ type: "EXPENSE", amount: "-100", categoryId: "c1", categoryName: "Courses" }),
      ],
      { monthCount: 3 },
    );

    // 100 / 3 = 33.333… → 33.33.
    expect(averages[0].monthlyAverage.toFixed(2)).toBe("33.33");
    expect(averages.map((average) => average.kind)).toEqual(["EXPENSE", "INCOME"]);
  });

  it("refuses a window of zero months rather than dividing by zero", () => {
    expect(() => computeCategoryAverages([], { monthCount: 0 })).toThrow();
  });
});
