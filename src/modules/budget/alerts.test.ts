import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { AlertRuleConfig } from "@/modules/alerts/domain";
import type { TransactionRecord } from "./domain";
import { evaluateBudgetOverrun, evaluateBudgetThreshold, evaluateLowBalance, evaluateUnusualExpense } from "./alerts";
import type { BudgetReportRow } from "./report";

/** Fictitious data only. Every rule is pure, so fixed dates are enough. */

function rule(overrides: Partial<AlertRuleConfig> & { kind: AlertRuleConfig["kind"] }): AlertRuleConfig {
  return {
    enabled: true,
    thresholdAmount: null,
    thresholdCurrency: null,
    thresholdPercent: null,
    thresholdDays: null,
    ...overrides,
  };
}

const threshold100 = rule({
  kind: "LOW_BALANCE",
  thresholdAmount: new Decimal("100"),
  thresholdCurrency: "EUR",
});

function account(overrides: Partial<Parameters<typeof evaluateLowBalance>[0][number]> = {}) {
  return {
    accountId: "account-1",
    accountName: "Compte courant",
    currency: "EUR" as const,
    transactionCount: 3,
    balance: new Decimal("42.50"),
    ...overrides,
  };
}

describe("evaluateLowBalance", () => {
  it("triggers when the recorded balance sits below the threshold", () => {
    const candidates = evaluateLowBalance([account()], threshold100);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].fingerprint).toBe("low-balance:account-1");
    expect(candidates[0].inputs.balance).toBe("42.50");
    expect(candidates[0].inputs.threshold).toBe("100.00");
    expect(candidates[0].inputs.currency).toBe("EUR");
  });

  it("does not trigger at the boundary: exactly at the threshold is not below it", () => {
    expect(evaluateLowBalance([account({ balance: new Decimal("100") })], threshold100)).toEqual([]);
  });

  it("skips an account with no recorded transaction: its balance is unknown, not zero", () => {
    const empty = account({ transactionCount: 0, balance: new Decimal(0) });

    expect(evaluateLowBalance([empty], threshold100)).toEqual([]);
  });

  it("flags overdrawn accounts with a zero threshold, in every currency", () => {
    const zero = rule({ kind: "LOW_BALANCE", thresholdAmount: new Decimal(0) });

    const overdrawn = account({ balance: new Decimal("-10") });
    const exactlyZero = account({ accountId: "a2", balance: new Decimal(0) });
    const positive = account({ accountId: "a3", balance: new Decimal("1") });

    const candidates = evaluateLowBalance([overdrawn, exactlyZero, positive], zero);
    expect(candidates.map((candidate) => candidate.fingerprint)).toEqual(["low-balance:account-1"]);
  });

  it("skips accounts in another currency when the threshold is positive", () => {
    const usd = account({ accountId: "account-usd", currency: "USD", balance: new Decimal("10") });

    expect(evaluateLowBalance([usd], threshold100)).toEqual([]);
  });

  it("stays quiet when disabled", () => {
    expect(evaluateLowBalance([account()], { ...threshold100, enabled: false })).toEqual([]);
  });
});

function expenseRow(overrides: Partial<BudgetReportRow> = {}): BudgetReportRow {
  return {
    key: "category-1|EUR",
    categoryId: "category-1",
    categoryName: "Courses",
    categoryKind: "EXPENSE",
    currency: "EUR",
    planned: new Decimal("300"),
    actual: new Decimal("320"),
    remaining: new Decimal("-20"),
    ...overrides,
  };
}

describe("evaluateBudgetOverrun", () => {
  const anyOverrun = rule({ kind: "BUDGET_OVERRUN", thresholdPercent: new Decimal(0) });

  it("triggers on any overrun by default, with the exact figures", () => {
    const candidates = evaluateBudgetOverrun([expenseRow()], anyOverrun, { monthKey: "2026-10" });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].fingerprint).toBe("budget-overrun:category-1:EUR:2026-10");
    expect(candidates[0].inputs.overrun).toBe("20.00");
    expect(candidates[0].inputs.overrunPercent).toBe("6.7");
    expect(candidates[0].inputs.planned).toBe("300.00");
  });

  it("does not trigger while the budget holds", () => {
    const row = expenseRow({ actual: new Decimal("300"), remaining: new Decimal(0) });

    expect(evaluateBudgetOverrun([row], anyOverrun, { monthKey: "2026-10" })).toEqual([]);
  });

  it("compares the margin on the exact percentage, boundary included", () => {
    const margin10 = rule({ kind: "BUDGET_OVERRUN", thresholdPercent: new Decimal(10) });

    // Exactly 10 % over: reaches the margin.
    const exact = expenseRow({
      planned: new Decimal("100"),
      actual: new Decimal("110"),
      remaining: new Decimal("-10"),
    });
    expect(evaluateBudgetOverrun([exact], margin10, { monthKey: "2026-10" })).toHaveLength(1);

    // 9.99 % over: below the margin, even though it would round to 10.0 for display.
    const justBelow = expenseRow({
      planned: new Decimal("100"),
      actual: new Decimal("109.99"),
      remaining: new Decimal("-9.99"),
    });
    expect(evaluateBudgetOverrun([justBelow], margin10, { monthKey: "2026-10" })).toEqual([]);
  });

  it("ignores income targets: falling short of a goal is not an overrun", () => {
    const incomeGoal = expenseRow({ categoryKind: "INCOME", actual: new Decimal("1500") });

    expect(evaluateBudgetOverrun([incomeGoal], anyOverrun, { monthKey: "2026-10" })).toEqual([]);
  });

  it("stays quiet when the month's transactions were only read in part", () => {
    expect(
      evaluateBudgetOverrun([expenseRow()], anyOverrun, { monthKey: "2026-10", truncated: true }),
    ).toEqual([]);
  });

  it("stays quiet when disabled", () => {
    expect(
      evaluateBudgetOverrun([expenseRow()], { ...anyOverrun, enabled: false }, { monthKey: "2026-10" }),
    ).toEqual([]);
  });
});

describe("evaluateBudgetThreshold", () => {
  const threshold80 = rule({
    kind: "BUDGET_THRESHOLD",
    thresholdPercent: new Decimal(80),
  });

  it("triggers once the realized reaches the configured share of the envelope", () => {
    const row = expenseRow({ actual: new Decimal("250"), remaining: new Decimal("50") });
    const candidates = evaluateBudgetThreshold([row], threshold80, { monthKey: "2026-10" });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].fingerprint).toBe("budget-threshold:category-1:EUR:2026-10");
    expect(candidates[0].inputs.percent).toBe("83.3");
    expect(candidates[0].inputs.thresholdPercent).toBe("80");
    expect(candidates[0].inputs.actual).toBe("250.00");
  });

  it("triggers exactly at the threshold, boundary included", () => {
    const row = expenseRow({ actual: new Decimal("240"), remaining: new Decimal("60") });

    expect(evaluateBudgetThreshold([row], threshold80, { monthKey: "2026-10" })).toHaveLength(1);
  });

  it("stays quiet below the threshold", () => {
    const row = expenseRow({ actual: new Decimal("239.99"), remaining: new Decimal("60.01") });

    expect(evaluateBudgetThreshold([row], threshold80, { monthKey: "2026-10" })).toEqual([]);
  });

  it("still runs when the envelope is exactly used up: the overrun rule only covers real overruns", () => {
    const row = expenseRow({ actual: new Decimal("300"), remaining: new Decimal(0) });

    expect(evaluateBudgetThreshold([row], threshold80, { monthKey: "2026-10" })).toHaveLength(1);
  });

  it("hands the situation over to the overrun rule the moment the plan is exceeded", () => {
    // 320 for 300: the overrun rule's situation, never both at once.
    expect(evaluateBudgetThreshold([expenseRow()], threshold80, { monthKey: "2026-10" })).toEqual([]);
  });

  it("never fires on a refund-dominated envelope (negative actual)", () => {
    const row = expenseRow({ actual: new Decimal("-20"), remaining: new Decimal("320") });

    expect(evaluateBudgetThreshold([row], threshold80, { monthKey: "2026-10" })).toEqual([]);
  });

  it("ignores income targets and truncated reads, like the overrun rule", () => {
    const incomeGoal = expenseRow({ categoryKind: "INCOME" });

    expect(evaluateBudgetThreshold([incomeGoal], threshold80, { monthKey: "2026-10" })).toEqual([]);
    expect(
      evaluateBudgetThreshold([expenseRow()], threshold80, {
        monthKey: "2026-10",
        truncated: true,
      }),
    ).toEqual([]);
  });

  it("stays quiet when disabled", () => {
    expect(
      evaluateBudgetThreshold([expenseRow()], { ...threshold80, enabled: false }, { monthKey: "2026-10" }),
    ).toEqual([]);
  });

  it("a zero threshold fires as soon as anything is spent, without overlapping the overrun", () => {
    const zero = rule({ kind: "BUDGET_THRESHOLD", thresholdPercent: new Decimal(0) });
    const spent = expenseRow({ actual: new Decimal("1"), remaining: new Decimal("299") });

    expect(evaluateBudgetThreshold([spent], zero, { monthKey: "2026-10" })).toHaveLength(1);
    // Nothing spent yet: even a zero threshold does not accuse an untouched envelope.
    const untouched = expenseRow({ actual: new Decimal(0), remaining: new Decimal("300") });
    expect(evaluateBudgetThreshold([untouched], zero, { monthKey: "2026-10" })).toEqual([]);
  });
});

function transaction(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    id: "tx-1",
    type: "EXPENSE",
    amount: new Decimal("-650"),
    currency: "EUR",
    operationDate: new Date(Date.UTC(2026, 9, 3)),
    label: "Achat ordinateur",
    accountId: "account-1",
    accountName: "Compte courant",
    categoryId: null,
    categoryName: null,
    notes: null,
    externalRef: null,
    transferGroupId: null,
    reconciledAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 3, 8, 0)),
    ...overrides,
  };
}

describe("evaluateUnusualExpense", () => {
  const threshold500 = rule({
    kind: "UNUSUAL_EXPENSE",
    thresholdAmount: new Decimal("500"),
    thresholdCurrency: "EUR",
  });

  it("triggers at or above the threshold, and stores the magnitude", () => {
    const candidates = evaluateUnusualExpense([transaction()], threshold500);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].fingerprint).toBe("unusual-expense:tx-1");
    expect(candidates[0].inputs.amount).toBe("650.00");
    expect(candidates[0].inputs.date).toBe("2026-10-03");
    expect(candidates[0].inputs.label).toBe("Achat ordinateur");
  });

  it("triggers exactly at the threshold (boundary)", () => {
    const exact = transaction({ amount: new Decimal("-500") });

    expect(evaluateUnusualExpense([exact], threshold500)).toHaveLength(1);
  });

  it("does not trigger below the threshold", () => {
    const small = transaction({ amount: new Decimal("-499.99") });

    expect(evaluateUnusualExpense([small], threshold500)).toEqual([]);
  });

  it("ignores incomes and transfers", () => {
    const income = transaction({ id: "tx-2", type: "INCOME", amount: new Decimal("2000") });
    const transfer = transaction({ id: "tx-3", type: "TRANSFER", amount: new Decimal("-800") });

    expect(evaluateUnusualExpense([income, transfer], threshold500)).toEqual([]);
  });

  it("ignores machine-booked lines: a confirmed prévision or a salary is expected", () => {
    const booked = transaction({ externalRef: "forecast:occ-1" });

    expect(evaluateUnusualExpense([booked], threshold500)).toEqual([]);
  });

  it("only compares expenses in the threshold's currency — no conversion", () => {
    const usd = transaction({ currency: "USD" });

    expect(evaluateUnusualExpense([usd], threshold500)).toEqual([]);
  });

  it("stays quiet without a positive threshold or a currency", () => {
    const noCurrency = { ...threshold500, thresholdCurrency: null };
    const zero = { ...threshold500, thresholdAmount: new Decimal(0) };

    expect(evaluateUnusualExpense([transaction()], noCurrency)).toEqual([]);
    expect(evaluateUnusualExpense([transaction()], zero)).toEqual([]);
  });

  it("stays quiet when the month read was partial or when disabled", () => {
    expect(evaluateUnusualExpense([transaction()], threshold500, { truncated: true })).toEqual([]);
    expect(evaluateUnusualExpense([transaction()], { ...threshold500, enabled: false })).toEqual([]);
  });
});
