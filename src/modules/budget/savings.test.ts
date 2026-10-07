import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { RecurringEntryRecord } from "./recurrence";
import {
  buildSavingsThresholds,
  savingsWindow,
  SAVINGS_THRESHOLD_MONTHS,
  type SavingsAccount,
} from "./savings";

/** Fictitious data only. Every figure is pure: a fixed window, no database. */

const NOW = new Date(Date.UTC(2026, 9, 7)); // 2026-10-07

function entry(overrides: Partial<RecurringEntryRecord> = {}): RecurringEntryRecord {
  return {
    id: "entry-1",
    accountId: "account-1",
    accountName: "Compte courant",
    categoryId: null,
    categoryName: null,
    type: "EXPENSE",
    label: "Loyer",
    amount: new Decimal("950"),
    frequency: "MONTHLY",
    startDate: new Date(Date.UTC(2026, 0, 5)),
    endDate: null,
    ...overrides,
  };
}

function savings(overrides: Partial<SavingsAccount> = {}): SavingsAccount {
  return {
    accountId: "savings-1",
    accountName: "Livret A",
    currency: "EUR",
    transactionCount: 4,
    balance: new Decimal("3000"),
    ...overrides,
  };
}

const EUR_ACCOUNT = new Map([["account-1", "EUR" as const]]);

describe("savingsWindow", () => {
  it("covers the current month and the five following ones", () => {
    expect(savingsWindow(NOW)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
    ]);
    expect(savingsWindow(NOW)).toHaveLength(SAVINGS_THRESHOLD_MONTHS);
  });

  it("wraps around the year end", () => {
    expect(savingsWindow(new Date(Date.UTC(2026, 10, 15)))).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
      "2027-04",
    ]);
  });
});

describe("buildSavingsThresholds", () => {
  it("adds up six months of expected expenses from the recurring series", () => {
    const [threshold] = buildSavingsThresholds({
      entries: [entry()],
      currencyByAccount: EUR_ACCOUNT,
      savingsAccounts: [],
      months: savingsWindow(NOW),
    });

    expect(threshold.currency).toBe("EUR");
    expect(threshold.expectedTotal.toFixed(2)).toBe("5700.00");
    expect(threshold.seriesCount).toBe(1);
    expect(threshold.months.map((month) => month.amount.toFixed(2))).toEqual([
      "950.00",
      "950.00",
      "950.00",
      "950.00",
      "950.00",
      "950.00",
    ]);
  });

  it("clamps a series declared on the 31st to shorter months, like the forecasts", () => {
    const [threshold] = buildSavingsThresholds({
      entries: [entry({ amount: new Decimal("30"), startDate: new Date(Date.UTC(2026, 0, 31)) })],
      currencyByAccount: EUR_ACCOUNT,
      savingsAccounts: [],
      months: savingsWindow(NOW),
    });

    // October (31 days), November (30), December, January, February (28), March.
    expect(threshold.expectedTotal.toFixed(2)).toBe("180.00");
    expect(threshold.months).toHaveLength(6);
    expect(threshold.months.some((month) => month.amount.toFixed(2) === "30.00")).toBe(true);
  });

  it("counts only the months a series actually covers", () => {
    const starting = buildSavingsThresholds({
      entries: [entry({ startDate: new Date(Date.UTC(2027, 0, 15)) })], // January 2027
      currencyByAccount: EUR_ACCOUNT,
      savingsAccounts: [],
      months: savingsWindow(NOW),
    });
    // January, February, March of 2027: three occurrences.
    expect(starting[0].expectedTotal.toFixed(2)).toBe("2850.00");

    const ended = buildSavingsThresholds({
      entries: [entry({ endDate: new Date(Date.UTC(2026, 10, 30)) })], // ends 2026-11-30
      currencyByAccount: EUR_ACCOUNT,
      savingsAccounts: [],
      months: savingsWindow(NOW),
    });
    // October and November only.
    expect(ended[0].expectedTotal.toFixed(2)).toBe("1900.00");
  });

  it("ignores income series: the cushion covers what goes out", () => {
    const thresholds = buildSavingsThresholds({
      entries: [entry({ type: "INCOME", label: "Salaire", amount: new Decimal("2000") })],
      currencyByAccount: EUR_ACCOUNT,
      savingsAccounts: [savings()],
      months: savingsWindow(NOW),
    });

    expect(thresholds).toEqual([]);
  });

  it("keeps currencies apart and resolves each series through its account", () => {
    const thresholds = buildSavingsThresholds({
      entries: [
        entry(),
        entry({
          id: "entry-usd",
          accountId: "account-usd",
          amount: new Decimal("200"),
          label: "Assurance",
        }),
      ],
      currencyByAccount: new Map([
        ["account-1", "EUR"],
        ["account-usd", "USD"],
      ]),
      savingsAccounts: [savings()],
      months: savingsWindow(NOW),
    });

    expect(thresholds.map((threshold) => threshold.currency)).toEqual(["EUR", "USD"]);
    expect(thresholds[0].expectedTotal.toFixed(2)).toBe("5700.00");
    expect(thresholds[1].expectedTotal.toFixed(2)).toBe("1200.00");
    // The EUR cushion never counts the USD series, and vice versa.
    expect(thresholds[1].savingsBalance).toBeNull();
  });

  it("adds up the recorded savings accounts of one currency and measures the gap", () => {
    const [threshold] = buildSavingsThresholds({
      entries: [entry()],
      currencyByAccount: EUR_ACCOUNT,
      savingsAccounts: [
        savings({ balance: new Decimal("2000") }),
        savings({ accountId: "savings-2", accountName: "LEP", balance: new Decimal("1000") }),
      ],
      months: savingsWindow(NOW),
    });

    expect(threshold.savingsAccountCount).toBe(2);
    expect(threshold.recordedAccountCount).toBe(2);
    expect(threshold.savingsBalance?.toFixed(2)).toBe("3000.00");
    // 3000 ÷ 5700 = 52.63… % → 52.6 %.
    expect(threshold.progress?.toFixed(1)).toBe("52.6");
    expect(threshold.shortfall?.toFixed(2)).toBe("2700.00");
  });

  it("reads a cushion above the threshold as a negative shortfall and a progress above 100", () => {
    const [threshold] = buildSavingsThresholds({
      entries: [entry()],
      currencyByAccount: EUR_ACCOUNT,
      savingsAccounts: [savings({ balance: new Decimal("6000") })],
      months: savingsWindow(NOW),
    });

    expect(threshold.shortfall?.toFixed(2)).toBe("-300.00");
    expect(threshold.progress?.toFixed(1)).toBe("105.3");
  });

  it("reads an unrecorded savings account as unknown — never as zero", () => {
    const [threshold] = buildSavingsThresholds({
      entries: [entry()],
      currencyByAccount: EUR_ACCOUNT,
      savingsAccounts: [savings({ transactionCount: 0, balance: new Decimal(0) })],
      months: savingsWindow(NOW),
    });

    expect(threshold.savingsAccountCount).toBe(1);
    expect(threshold.recordedAccountCount).toBe(0);
    expect(threshold.savingsBalance).toBeNull();
    expect(threshold.progress).toBeNull();
    expect(threshold.shortfall).toBeNull();
  });

  it("reads a recorded balance of exactly zero as a known zero", () => {
    const [threshold] = buildSavingsThresholds({
      entries: [entry()],
      currencyByAccount: EUR_ACCOUNT,
      savingsAccounts: [savings({ balance: new Decimal(0) })],
      months: savingsWindow(NOW),
    });

    expect(threshold.savingsBalance?.toFixed(2)).toBe("0.00");
    expect(threshold.progress?.toFixed(1)).toBe("0.0");
    expect(threshold.shortfall?.toFixed(2)).toBe("5700.00");
  });

  it("reports no savings account when the owner has none in that currency", () => {
    const [threshold] = buildSavingsThresholds({
      entries: [entry()],
      currencyByAccount: EUR_ACCOUNT,
      savingsAccounts: [],
      months: savingsWindow(NOW),
    });

    expect(threshold.savingsAccountCount).toBe(0);
    expect(threshold.savingsBalance).toBeNull();
  });

  it("falls back to the default currency for a series on an unknown account", () => {
    const [threshold] = buildSavingsThresholds({
      entries: [entry({ accountId: "deleted-account" })],
      currencyByAccount: EUR_ACCOUNT,
      savingsAccounts: [],
      months: savingsWindow(NOW),
    });

    expect(threshold.currency).toBe("EUR");
  });

  it("returns nothing when no expense series covers the window", () => {
    expect(
      buildSavingsThresholds({
        entries: [],
        currencyByAccount: EUR_ACCOUNT,
        savingsAccounts: [savings()],
        months: savingsWindow(NOW),
      }),
    ).toEqual([]);
  });
});
