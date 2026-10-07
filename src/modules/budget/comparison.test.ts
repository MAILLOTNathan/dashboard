import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { Currency } from "@/lib/money";
import type { TransactionRecord, TransactionType } from "./domain";
import { buildComparison } from "./comparison";

/** Fictitious data only: no real transaction ever appears in a test. */
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
    operationDate: overrides.operationDate ?? new Date(Date.UTC(2026, 9, 5)),
    label: overrides.label ?? "Opération de test",
    accountId: overrides.accountId ?? "account-1",
    accountName: overrides.accountName ?? null,
    categoryId: overrides.categoryId ?? null,
    categoryName: overrides.categoryName ?? null,
    notes: overrides.notes ?? null,
    externalRef: overrides.externalRef ?? null,
    transferGroupId: overrides.transferGroupId ?? null,
    reconciledAt: overrides.reconciledAt ?? null,
    createdAt: new Date(Date.UTC(2026, 9, 5)),
  };
}

describe("buildComparison", () => {
  it("compares the current month to the previous one, per currency", () => {
    const rows = buildComparison({
      current: [transaction({ type: "INCOME", amount: "3000" }), transaction({ type: "EXPENSE", amount: "-1000" })],
      previous: [transaction({ type: "INCOME", amount: "2500" }), transaction({ type: "EXPENSE", amount: "-800" })],
      sameMonthLastYear: [transaction({ type: "INCOME", amount: "2000" })],
    });

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.currency).toBe("EUR");
    expect(row.current.net.toFixed(2)).toBe("2000.00");
    expect(row.previous?.net.toFixed(2)).toBe("1700.00");
    expect(row.sameMonthLastYear?.net.toFixed(2)).toBe("2000.00");
    expect(row.netDelta?.toFixed(2)).toBe("300.00");
    // 300 / |1700| × 100, rounded half-up to one decimal.
    expect(row.netPercent?.toFixed(1)).toBe("17.6");
  });

  it("returns null sides when a month holds nothing in that currency — never a zero month", () => {
    const rows = buildComparison({
      current: [transaction({ type: "EXPENSE", amount: "-50" })],
      previous: [],
      sameMonthLastYear: [],
    });

    expect(rows[0].previous).toBeNull();
    expect(rows[0].sameMonthLastYear).toBeNull();
    expect(rows[0].netDelta).toBeNull();
    expect(rows[0].netPercent).toBeNull();
  });

  it("scores the percentage against the absolute previous net, so its sign follows the delta", () => {
    const rows = buildComparison({
      current: [transaction({ type: "EXPENSE", amount: "-50" })],
      previous: [transaction({ type: "EXPENSE", amount: "-100" })],
      sameMonthLastYear: [],
    });

    // Net went from −100 to −50: an improvement of +50, of a 100 basis.
    expect(rows[0].netDelta?.toFixed(2)).toBe("50.00");
    expect(rows[0].netPercent?.toFixed(1)).toBe("50.0");
  });

  it("leaves the percentage undefined on a zero base: no honest rate exists", () => {
    const rows = buildComparison({
      current: [transaction({ type: "EXPENSE", amount: "-50" })],
      previous: [transaction({ type: "EXPENSE", amount: "-100" }), transaction({ type: "INCOME", amount: "100" })],
      sameMonthLastYear: [],
    });

    expect(rows[0].previous?.net.toFixed(2)).toBe("0.00");
    expect(rows[0].netDelta?.toFixed(2)).toBe("-50.00");
    expect(rows[0].netPercent).toBeNull();
  });

  it("keeps currencies separate: another currency's previous month is not a base", () => {
    const rows = buildComparison({
      current: [transaction({ type: "EXPENSE", amount: "-50", currency: "USD" })],
      previous: [transaction({ type: "EXPENSE", amount: "-80", currency: "EUR" })],
      sameMonthLastYear: [],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe("USD");
    expect(rows[0].previous).toBeNull();
  });
});
