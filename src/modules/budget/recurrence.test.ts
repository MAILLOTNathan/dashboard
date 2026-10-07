import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { toDateOnlyString } from "@/lib/dates";
import {
  ALREADY_CONFIRMED_MESSAGE,
  decisionBlockedReason,
  forecastOccurrenceRef,
  occurrenceDatesForMonth,
  plannedContributions,
  plannedOccurrences,
  recurringEntryInputSchema,
  signedForecastAmount,
  startDateChangeRefusedReason,
  summariseForecastMonth,
  type ForecastContribution,
  type RecurringEntryRecord,
} from "./recurrence";

/** Fictitious values only. Dates are calendar days at UTC midnight, like the app. */

function entry(overrides: Partial<RecurringEntryRecord> = {}): RecurringEntryRecord {
  return {
    id: "entry-1",
    accountId: "account-1",
    accountName: "Compte courant",
    categoryId: "category-1",
    categoryName: "Logement",
    type: "EXPENSE",
    label: "Loyer",
    amount: new Decimal("950"),
    frequency: "MONTHLY",
    startDate: new Date(Date.UTC(2026, 0, 5)),
    endDate: null,
    ...overrides,
  };
}

function daysOf(dates: Date[]): string[] {
  return dates.map(toDateOnlyString);
}

function day(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

describe("occurrenceDatesForMonth", () => {
  it("occurs on the start date's day of month", () => {
    const dates = occurrenceDatesForMonth(entry(), 2026, 2);

    expect(daysOf(dates)).toEqual(["2026-02-05"]);
  });

  it("clamps the 31st to the last day of a shorter month, without propagating", () => {
    const series = entry({ startDate: day(2026, 1, 31) });

    expect(daysOf(occurrenceDatesForMonth(series, 2026, 2))).toEqual(["2026-02-28"]);
    expect(daysOf(occurrenceDatesForMonth(series, 2026, 4))).toEqual(["2026-04-30"]);
    // The clamp never propagates: a longer month falls back on the 31st.
    expect(daysOf(occurrenceDatesForMonth(series, 2026, 3))).toEqual(["2026-03-31"]);
  });

  it("keeps the 29th when February is long enough, and clamps when it is not", () => {
    const series = entry({ startDate: day(2027, 1, 29) });

    // 2028 is a leap year: the 29th exists; 2027 has no 29 February at all.
    expect(daysOf(occurrenceDatesForMonth(series, 2028, 2))).toEqual(["2028-02-29"]);
    expect(daysOf(occurrenceDatesForMonth(series, 2027, 2))).toEqual(["2027-02-28"]);
  });

  it("never occurs before the series starts", () => {
    const series = entry({ startDate: day(2026, 3, 15) });

    // The month before the start has no occurrence, even though the series exists.
    expect(occurrenceDatesForMonth(series, 2026, 2)).toEqual([]);
    expect(daysOf(occurrenceDatesForMonth(series, 2026, 3))).toEqual(["2026-03-15"]);
  });

  it("treats the end date as inclusive and stops after it", () => {
    const series = entry({ endDate: day(2026, 2, 4) });

    // The February occurrence (the 5th) falls after the end: the series is over.
    expect(occurrenceDatesForMonth(series, 2026, 2)).toEqual([]);
    expect(daysOf(occurrenceDatesForMonth(series, 2026, 1))).toEqual(["2026-01-05"]);

    const inclusive = entry({ endDate: day(2026, 2, 5) });
    expect(daysOf(occurrenceDatesForMonth(inclusive, 2026, 2))).toEqual(["2026-02-05"]);
  });

  it("occurs exactly once per month: recurrence is monthly", () => {
    expect(occurrenceDatesForMonth(entry(), 2026, 10)).toHaveLength(1);
  });
});

describe("plannedOccurrences", () => {
  it("flattens several series into the (series, date) pairs a month needs", () => {
    const rows = plannedOccurrences(
      [
        entry({ id: "entry-1" }),
        entry({ id: "entry-2", label: "Salaire", type: "INCOME", startDate: day(2026, 1, 27) }),
        // Out of the window: contributes nothing.
        entry({ id: "entry-3", startDate: day(2026, 5, 10) }),
      ],
      2026,
      2,
    );

    expect(rows.map((row) => `${row.recurringId}|${toDateOnlyString(row.date)}`)).toEqual([
      "entry-1|2026-02-05",
      "entry-2|2026-02-27",
    ]);
  });
});

describe("signedForecastAmount", () => {
  it("writes an expense negative and an income positive", () => {
    expect(signedForecastAmount("EXPENSE", new Decimal("950")).toFixed(2)).toBe("-950.00");
    expect(signedForecastAmount("INCOME", new Decimal("950")).toFixed(2)).toBe("950.00");
  });
});

describe("forecastOccurrenceRef", () => {
  it("is stable and scoped to the occurrence", () => {
    expect(forecastOccurrenceRef("occ-1")).toBe("forecast:occ-1");
  });
});

function contribution(
  overrides: Partial<ForecastContribution> = {},
): ForecastContribution {
  return {
    currency: "EUR",
    type: "EXPENSE",
    amount: new Decimal("950"),
    status: "PENDING",
    ...overrides,
  };
}

describe("summariseForecastMonth", () => {
  it("sums expected income and expenses into a net", () => {
    const totals = summariseForecastMonth([
      contribution({ type: "INCOME", amount: new Decimal("461.25") }),
      contribution({ amount: new Decimal("950") }),
      contribution({ amount: new Decimal("20") }),
      contribution({ amount: new Decimal("30") }),
    ]);

    expect(totals).toHaveLength(1);
    // The expense magnitude reads positive, like every monthly total.
    expect(totals[0]?.income.toFixed(2)).toBe("461.25");
    expect(totals[0]?.expenses.toFixed(2)).toBe("1000.00");
    expect(totals[0]?.net.toFixed(2)).toBe("-538.75");
    expect(totals[0]?.count).toBe(4);
    expect(totals[0]?.confirmedCount).toBe(0);
  });

  it("counts a confirmed échéance and drops the skipped and dismissed ones", () => {
    const totals = summariseForecastMonth([
      // A prévision that came true stays part of what the month was expected to be.
      contribution({ status: "CONFIRMED" }),
      // "Did not happen" and "set aside" are precisely the statement that it counts no more.
      contribution({ status: "SKIPPED" }),
      contribution({ status: "DISMISSED" }),
      contribution({ status: "PENDING", amount: new Decimal("30") }),
    ]);

    expect(totals[0]?.expenses.toFixed(2)).toBe("980.00");
    expect(totals[0]?.count).toBe(2);
    expect(totals[0]?.confirmedCount).toBe(1);
  });

  it("keeps currencies apart, sorted, with no conversion", () => {
    const totals = summariseForecastMonth([
      contribution({ currency: "USD", amount: new Decimal("200") }),
      contribution({ currency: "EUR", amount: new Decimal("100") }),
    ]);

    expect(totals.map((total) => `${total.currency}|${total.expenses.toFixed(2)}`)).toEqual([
      "EUR|100.00",
      "USD|200.00",
    ]);
  });

  it("returns no total for a month without a counted movement", () => {
    expect(summariseForecastMonth([])).toEqual([]);
    expect(summariseForecastMonth([contribution({ status: "SKIPPED" })])).toEqual([]);
  });
});

describe("decisionBlockedReason", () => {
  it("lets a pending occurrence be decided", () => {
    expect(decisionBlockedReason("PENDING")).toBeNull();
  });

  it("tells each decided state apart, with the audit message for a confirmation", () => {
    expect(decisionBlockedReason("CONFIRMED")).toBe(ALREADY_CONFIRMED_MESSAGE);
    expect(decisionBlockedReason("SKIPPED")).toMatch(/déjà passée/);
    expect(decisionBlockedReason("DISMISSED")).toMatch(/déjà écartée/);
  });
});

describe("recurringEntryInputSchema", () => {
  it("accepts a complete payload and normalises its values", () => {
    const parsed = recurringEntryInputSchema.safeParse({
      accountId: "account-1",
      categoryId: "category-1",
      type: "EXPENSE",
      label: " Loyer ",
      amount: "950,00",
      frequency: "MONTHLY",
      startDate: "2026-10-05",
      endDate: "",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.label).toBe("Loyer");
      expect(parsed.data.amount.toFixed(2)).toBe("950.00");
      expect(parsed.data.endDate).toBeNull();
      expect(toDateOnlyString(parsed.data.startDate)).toBe("2026-10-05");
    }
  });

  it("refuses an amount that is not strictly positive", () => {
    const base = {
      accountId: "account-1",
      categoryId: "",
      type: "EXPENSE",
      label: "Loyer",
      frequency: "MONTHLY",
      startDate: "2026-10-05",
      endDate: "",
    };

    expect(recurringEntryInputSchema.safeParse({ ...base, amount: "0" }).success).toBe(false);
    expect(recurringEntryInputSchema.safeParse({ ...base, amount: "-10" }).success).toBe(false);
  });

  it("refuses an end date before the start date", () => {
    const parsed = recurringEntryInputSchema.safeParse({
      accountId: "account-1",
      categoryId: "",
      type: "EXPENSE",
      label: "Loyer",
      amount: "950",
      frequency: "MONTHLY",
      startDate: "2026-10-05",
      endDate: "2026-09-05",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join() === "endDate")).toBe(true);
    }
  });

  it("refuses a transfer: a forecast is an income or an expense, never a move", () => {
    const parsed = recurringEntryInputSchema.safeParse({
      accountId: "account-1",
      categoryId: "",
      type: "TRANSFER",
      label: "Virement",
      amount: "950",
      frequency: "MONTHLY",
      startDate: "2026-10-05",
      endDate: "",
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses an impossible calendar day", () => {
    const parsed = recurringEntryInputSchema.safeParse({
      accountId: "account-1",
      categoryId: "",
      type: "EXPENSE",
      label: "Loyer",
      amount: "950",
      frequency: "MONTHLY",
      startDate: "2026-02-31",
      endDate: "",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("quarterly and yearly cadences", () => {
  it("occurs every third month, counted from the start month", () => {
    const series = entry({ frequency: "QUARTERLY", startDate: day(2026, 2, 15) });

    // February, May, August, November — the start month anchors the cadence.
    expect(daysOf(occurrenceDatesForMonth(series, 2026, 2))).toEqual(["2026-02-15"]);
    expect(occurrenceDatesForMonth(series, 2026, 3)).toEqual([]);
    expect(occurrenceDatesForMonth(series, 2026, 4)).toEqual([]);
    expect(daysOf(occurrenceDatesForMonth(series, 2026, 5))).toEqual(["2026-05-15"]);
    expect(daysOf(occurrenceDatesForMonth(series, 2026, 11))).toEqual(["2026-11-15"]);
    expect(occurrenceDatesForMonth(series, 2026, 12)).toEqual([]);
    // The cadence crosses the year: February 2027 is aligned again.
    expect(daysOf(occurrenceDatesForMonth(series, 2027, 2))).toEqual(["2027-02-15"]);
  });

  it("occurs in the start month only, once a year", () => {
    const series = entry({ frequency: "YEARLY", startDate: day(2026, 9, 30) });

    expect(daysOf(occurrenceDatesForMonth(series, 2026, 9))).toEqual(["2026-09-30"]);
    expect(occurrenceDatesForMonth(series, 2026, 10)).toEqual([]);
    expect(daysOf(occurrenceDatesForMonth(series, 2027, 9))).toEqual(["2027-09-30"]);
  });

  it("keeps the clamp and the bounds on the other cadences", () => {
    const series = entry({
      frequency: "QUARTERLY",
      startDate: day(2026, 1, 31),
      endDate: day(2026, 4, 15),
    });

    // April is aligned but its clamped candidate (the 30th) falls after the inclusive
    // end: the series is over.
    expect(occurrenceDatesForMonth(series, 2026, 4)).toEqual([]);
    expect(daysOf(occurrenceDatesForMonth(series, 2026, 1))).toEqual(["2026-01-31"]);
  });
});

describe("startDateChangeRefusedReason", () => {
  it("allows the change until the first decision", () => {
    expect(startDateChangeRefusedReason(0)).toBeNull();
  });

  it("locks the start date once a decision exists", () => {
    expect(startDateChangeRefusedReason(2)).toMatch(/date de début/);
  });
});

describe("plannedContributions", () => {
  it("marks every planned occurrence pending, in the account's currency", () => {
    const entries = [
      entry({ id: "entry-1", accountId: "account-1" }),
      entry({
        id: "entry-2",
        accountId: "account-2",
        type: "INCOME",
        label: "Salaire",
        startDate: day(2026, 1, 27),
      }),
    ];
    const currencyByAccount = new Map([
      ["account-1", "EUR" as const],
      ["account-2", "USD" as const],
    ]);

    const contributions = plannedContributions(entries, 2026, 2, currencyByAccount);

    expect(contributions).toHaveLength(2);
    expect(contributions[0]).toMatchObject({ currency: "EUR", type: "EXPENSE", status: "PENDING" });
    expect(contributions[0].amount.toFixed(2)).toBe("950.00");
    expect(contributions[1]).toMatchObject({ currency: "USD", type: "INCOME" });
  });

  it("falls back to the default currency for an unknown account", () => {
    const contributions = plannedContributions(
      [entry()],
      2026,
      2,
      new Map(),
    );

    expect(contributions[0].currency).toBe("EUR");
  });
});
