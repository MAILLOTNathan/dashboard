import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  cashflowInputSchema,
  computePropertyTotals,
  isCashflowOverdue,
  resolveCashflowAmount,
  UnresolvedCashflowError,
  type CashflowEntry,
} from "./domain";

/** Fictitious amounts only. */
function entry(overrides: Partial<CashflowEntry> = {}): CashflowEntry {
  return {
    id: overrides.id ?? "cashflow-1",
    kind: overrides.kind ?? "EXPENSE",
    label: overrides.label ?? "Charge de test",
    currency: overrides.currency ?? "EUR",
    amount: overrides.amount ?? null,
    dueDate: overrides.dueDate ?? null,
    settledAt: overrides.settledAt ?? null,
    transaction: overrides.transaction ?? null,
  };
}

describe("resolveCashflowAmount", () => {
  it("uses the linked transaction amount", () => {
    const amount = resolveCashflowAmount(
      entry({
        transaction: { id: "tx-1", label: "Charges", amount: new Decimal("-250.00") },
      }),
    );

    expect(amount.toFixed(2)).toBe("-250.00");
  });

  it("ignores a duplicated amount on a linked entry: no double counting", () => {
    // Even if a stale row still carries an amount, the transaction wins.
    const amount = resolveCashflowAmount(
      entry({
        amount: new Decimal("-999.99"),
        transaction: { id: "tx-1", label: "Charges", amount: new Decimal("-250.00") },
      }),
    );

    expect(amount.toFixed(2)).toBe("-250.00");
  });

  it("uses its own amount for a standalone entry", () => {
    const amount = resolveCashflowAmount(entry({ amount: new Decimal("-80.00") }));

    expect(amount.toFixed(2)).toBe("-80.00");
  });

  it("refuses an entry with neither a transaction nor an amount", () => {
    expect(() => resolveCashflowAmount(entry())).toThrow(UnresolvedCashflowError);
  });
});

describe("computePropertyTotals", () => {
  it("returns zeros for a property without any entry, such as an unrented one", () => {
    const totals = computePropertyTotals([]);

    expect(totals.income.toFixed(2)).toBe("0.00");
    expect(totals.expenses.toFixed(2)).toBe("0.00");
    expect(totals.net.toFixed(2)).toBe("0.00");
  });

  it("totals standalone entries", () => {
    const totals = computePropertyTotals([
      entry({ kind: "INCOME", amount: new Decimal("900.00") }),
      entry({ id: "cashflow-2", kind: "EXPENSE", amount: new Decimal("-120.00") }),
    ]);

    expect(totals.income.toFixed(2)).toBe("900.00");
    expect(totals.expenses.toFixed(2)).toBe("120.00");
    expect(totals.net.toFixed(2)).toBe("780.00");
  });

  it("counts a transaction-linked entry exactly once", () => {
    const totals = computePropertyTotals([
      entry({
        kind: "EXPENSE",
        transaction: { id: "tx-1", label: "Travaux", amount: new Decimal("-500.00") },
      }),
    ]);

    expect(totals.expenses.toFixed(2)).toBe("500.00");
    expect(totals.net.toFixed(2)).toBe("-500.00");
  });

  it("reports expenses as a positive number even when the transaction is signed", () => {
    const totals = computePropertyTotals([
      entry({
        kind: "INCOME",
        transaction: { id: "tx-1", label: "Loyer", amount: new Decimal("750.00") },
      }),
      entry({
        id: "cashflow-2",
        kind: "EXPENSE",
        transaction: { id: "tx-2", label: "Taxe", amount: new Decimal("-200.00") },
      }),
    ]);

    expect(totals.expenses.toFixed(2)).toBe("200.00");
    expect(totals.net.toFixed(2)).toBe("550.00");
  });

  it("refuses to mix currencies in one property total", () => {
    expect(() =>
      computePropertyTotals([
        entry({ kind: "INCOME", amount: new Decimal("100.00"), currency: "EUR" }),
        entry({ id: "cashflow-2", kind: "INCOME", amount: new Decimal("100.00"), currency: "USD" }),
      ]),
    ).toThrow(/filter by currency first/);
  });
});

describe("isCashflowOverdue", () => {
  const today = new Date(Date.UTC(2026, 8, 30));

  it("is false without a due date", () => {
    expect(isCashflowOverdue({ dueDate: null, settledAt: null }, today)).toBe(false);
  });

  it("is true when the due date has passed and nothing is settled", () => {
    expect(
      isCashflowOverdue({ dueDate: new Date(Date.UTC(2026, 8, 15)), settledAt: null }, today),
    ).toBe(true);
  });

  it("is false once the entry is settled", () => {
    expect(
      isCashflowOverdue(
        { dueDate: new Date(Date.UTC(2026, 8, 15)), settledAt: new Date(Date.UTC(2026, 8, 16)) },
        today,
      ),
    ).toBe(false);
  });

  it("is false on the due date itself", () => {
    expect(
      isCashflowOverdue({ dueDate: today, settledAt: null }, today),
    ).toBe(false);
  });
});

describe("cashflowInputSchema", () => {
  it("accepts a standalone entry with an amount", () => {
    const result = cashflowInputSchema.safeParse({
      propertyId: "property-1",
      kind: "EXPENSE",
      label: "Taxe foncière",
      amount: "450,00",
      currency: "EUR",
    });

    expect(result.success).toBe(true);
  });

  it("accepts an entry linked to a transaction", () => {
    const result = cashflowInputSchema.safeParse({
      propertyId: "property-1",
      kind: "INCOME",
      label: "Loyer",
      transactionId: "tx-1",
      currency: "EUR",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an entry carrying both an amount and a transaction", () => {
    const result = cashflowInputSchema.safeParse({
      propertyId: "property-1",
      kind: "INCOME",
      label: "Loyer",
      amount: "900,00",
      transactionId: "tx-1",
      currency: "EUR",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an entry carrying neither", () => {
    const result = cashflowInputSchema.safeParse({
      propertyId: "property-1",
      kind: "INCOME",
      label: "Loyer",
      currency: "EUR",
    });

    expect(result.success).toBe(false);
  });
});
