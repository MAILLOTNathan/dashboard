import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { Currency } from "@/lib/money";
import type { TransactionRecord, TransactionType } from "./domain";
import {
  computeMonthlyTotals,
  computeTotalsByCurrency,
  groupByCurrency,
} from "./totals";

/** Fictitious data only: no real transaction ever appears in a test. */
function transaction(
  overrides: Omit<Partial<TransactionRecord>, "amount" | "type"> & {
    /** Passed as a string so the test reads like the stored value. */
    amount: string;
    type: TransactionType;
  },
): TransactionRecord {
  return {
    id: overrides.id ?? "tx-1",
    type: overrides.type,
    amount: new Decimal(overrides.amount),
    currency: (overrides.currency ?? "EUR") as Currency,
    operationDate: overrides.operationDate ?? new Date(Date.UTC(2026, 8, 1)),
    label: overrides.label ?? "Opération de test",
    accountId: overrides.accountId ?? "account-1",
    accountName: overrides.accountName ?? null,
    categoryId: overrides.categoryId ?? null,
    categoryName: overrides.categoryName ?? null,
    notes: overrides.notes ?? null,
    externalRef: overrides.externalRef ?? null,
  };
}

describe("computeMonthlyTotals", () => {
  it("returns zeros for a month without data, without inventing a value", () => {
    const totals = computeMonthlyTotals([]);

    expect(totals.transactionCount).toBe(0);
    expect(totals.income.toFixed(2)).toBe("0.00");
    expect(totals.expenses.toFixed(2)).toBe("0.00");
    expect(totals.net.toFixed(2)).toBe("0.00");
    expect(totals.transfers.toFixed(2)).toBe("0.00");
  });

  it("reports expenses as a positive number and computes the net balance", () => {
    const totals = computeMonthlyTotals([
      transaction({ type: "INCOME", amount: "2500.00" }),
      transaction({ id: "tx-2", type: "EXPENSE", amount: "-1200.50" }),
    ]);

    expect(totals.income.toFixed(2)).toBe("2500.00");
    expect(totals.expenses.toFixed(2)).toBe("1200.50");
    expect(totals.net.toFixed(2)).toBe("1299.50");
  });

  it("counts a transfer on the side its sign puts it, and reports its volume apart", () => {
    const totals = computeMonthlyTotals([
      transaction({ type: "INCOME", amount: "1000.00" }),
      transaction({ id: "tx-2", type: "EXPENSE", amount: "-300.00" }),
      transaction({ id: "tx-3", type: "TRANSFER", amount: "-400.00" }),
      transaction({ id: "tx-4", type: "TRANSFER", amount: "400.00" }),
    ]);

    // Both legs of one internal transfer: each side takes its own leg, so the net — what
    // actually happened to the accounts — does not move.
    expect(totals.income.toFixed(2)).toBe("1400.00");
    expect(totals.expenses.toFixed(2)).toBe("700.00");
    expect(totals.net.toFixed(2)).toBe("700.00");
    // `transfers` is a subset, not a fifth figure to add: it equals the sum of what the
    // transfers put on the two sides.
    expect(totals.transfers.toFixed(2)).toBe("800.00");
  });

  it("lowers the balance for a transfer recorded on one side only", () => {
    // Money sent to a savings account whose destination is not tracked: it did leave, so
    // the month says so. Excluding it by principle used to hide exactly this.
    const totals = computeMonthlyTotals([
      transaction({ type: "INCOME", amount: "2500.00" }),
      transaction({ id: "tx-2", type: "TRANSFER", amount: "-1000.00" }),
    ]);

    expect(totals.income.toFixed(2)).toBe("2500.00");
    expect(totals.expenses.toFixed(2)).toBe("1000.00");
    expect(totals.net.toFixed(2)).toBe("1500.00");
  });

  it("lets a zero transfer change no total", () => {
    const totals = computeMonthlyTotals([
      transaction({ type: "INCOME", amount: "100.00" }),
      transaction({ id: "tx-2", type: "TRANSFER", amount: "0.00" }),
    ]);

    expect(totals.income.toFixed(2)).toBe("100.00");
    expect(totals.expenses.toFixed(2)).toBe("0.00");
    expect(totals.net.toFixed(2)).toBe("100.00");
    expect(totals.transfers.toFixed(2)).toBe("0.00");
  });

  it("treats a positive amount on an expense as a reimbursement", () => {
    const totals = computeMonthlyTotals([
      transaction({ type: "EXPENSE", amount: "-100.00" }),
      transaction({ id: "tx-2", type: "EXPENSE", amount: "30.00", label: "Remboursement" }),
    ]);

    expect(totals.expenses.toFixed(2)).toBe("70.00");
    expect(totals.net.toFixed(2)).toBe("-70.00");
  });

  it("allows a month where reimbursements exceed expenses", () => {
    const totals = computeMonthlyTotals([
      transaction({ type: "EXPENSE", amount: "-20.00" }),
      transaction({ id: "tx-2", type: "EXPENSE", amount: "50.00", label: "Remboursement" }),
    ]);

    // Intentional: the month really did bring money back.
    expect(totals.expenses.toFixed(2)).toBe("-30.00");
    expect(totals.net.toFixed(2)).toBe("30.00");
  });

  it("lets a negative income correct a previous receipt", () => {
    const totals = computeMonthlyTotals([
      transaction({ type: "INCOME", amount: "200.00" }),
      transaction({ id: "tx-2", type: "INCOME", amount: "-50.00", label: "Correction" }),
    ]);

    expect(totals.income.toFixed(2)).toBe("150.00");
  });

  it("stays exact on amounts with cents", () => {
    const totals = computeMonthlyTotals([
      transaction({ type: "INCOME", amount: "0.10" }),
      transaction({ id: "tx-2", type: "INCOME", amount: "0.20" }),
    ]);

    expect(totals.income.toFixed(2)).toBe("0.30");
  });

  it("refuses to aggregate two currencies into one total", () => {
    expect(() =>
      computeMonthlyTotals([
        transaction({ type: "INCOME", amount: "100.00", currency: "EUR" }),
        transaction({ id: "tx-2", type: "INCOME", amount: "100.00", currency: "USD" }),
      ]),
    ).toThrow(/group transactions by currency first/);
  });
});

describe("groupByCurrency / computeTotalsByCurrency", () => {
  const mixed = [
    transaction({ type: "INCOME", amount: "100.00", currency: "EUR" }),
    transaction({ id: "tx-2", type: "INCOME", amount: "200.00", currency: "USD" }),
    transaction({ id: "tx-3", type: "EXPENSE", amount: "-40.00", currency: "EUR" }),
  ];

  it("groups transactions by currency", () => {
    const groups = groupByCurrency(mixed);

    expect(groups.get("EUR")).toHaveLength(2);
    expect(groups.get("USD")).toHaveLength(1);
  });

  it("produces one independent total per currency", () => {
    const totals = computeTotalsByCurrency(mixed);
    const byCurrency = new Map(totals.map((total) => [total.currency, total]));

    expect(byCurrency.get("EUR")?.net.toFixed(2)).toBe("60.00");
    expect(byCurrency.get("USD")?.net.toFixed(2)).toBe("200.00");
  });
});
