import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  adjustWorkDayHours,
  computeSalarySummary,
  hoursPerDaySchema,
  monthCalendarCells,
  nextWorkDayState,
  resolveSalaryRate,
  salaryBookingInputSchema,
  salaryBookingRef,
  salaryEquivalents,
  salaryMonthContribution,
  salarySettingInputSchema,
  workDayHoursInputSchema,
  workDayInputSchema,
  type WorkDayRecord,
} from "./salary";
import { summariseForecastMonth } from "./recurrence";

/** Fictitious values only. */

describe("salarySettingInputSchema", () => {
  const validSetting = {
    month: "2026-10",
    hourlyRate: "20,50",
    hoursPerDay: "7,5",
    currency: "EUR",
  };

  it("parses a hand-typed rate and day length into exact decimals", () => {
    const result = salarySettingInputSchema.safeParse(validSetting);

    expect(result.success).toBe(true);
    expect(result.data?.month).toEqual({ year: 2026, month: 10 });
    expect(result.data?.hourlyRate.toFixed(2)).toBe("20.50");
    expect(result.data?.hoursPerDay.toFixed(2)).toBe("7.50");
  });

  it("refuses a rate that is not strictly positive", () => {
    expect(
      salarySettingInputSchema.safeParse({ ...validSetting, hourlyRate: "0" }).success,
    ).toBe(false);
    expect(
      salarySettingInputSchema.safeParse({ ...validSetting, hourlyRate: "-10,00" }).success,
    ).toBe(false);
    expect(
      salarySettingInputSchema.safeParse({ ...validSetting, hourlyRate: "vingt" }).success,
    ).toBe(false);
  });

  it("refuses a month that does not exist, and a missing one", () => {
    expect(
      salarySettingInputSchema.safeParse({ ...validSetting, month: "2026-13" }).success,
    ).toBe(false);
    expect(salarySettingInputSchema.safeParse({ ...validSetting, month: "" }).success).toBe(
      false,
    );
  });

  it("refuses an unsupported currency", () => {
    const result = salarySettingInputSchema.safeParse({
      ...validSetting,
      currency: "XYZ",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Devise non prise en charge.");
  });

  it("bounds the day length to a plausible day", () => {
    expect(hoursPerDaySchema.safeParse("7").success).toBe(true);
    expect(hoursPerDaySchema.safeParse("24").success).toBe(true);
    expect(hoursPerDaySchema.safeParse("0").success).toBe(false);
    expect(hoursPerDaySchema.safeParse("24,5").success).toBe(false);
    expect(hoursPerDaySchema.safeParse("-1").success).toBe(false);
    // More than two decimals is rejected rather than rounded, like every amount.
    expect(hoursPerDaySchema.safeParse("7,333").success).toBe(false);
    expect(hoursPerDaySchema.safeParse("sept").success).toBe(false);
  });
});

describe("work day payloads", () => {
  it("turns a date-only field into a calendar day at UTC midnight", () => {
    const result = workDayInputSchema.safeParse({ date: "2026-10-05" });

    expect(result.success).toBe(true);
    expect(result.data?.date.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("refuses an impossible day", () => {
    expect(workDayInputSchema.safeParse({ date: "2026-02-31" }).success).toBe(false);
    expect(workDayInputSchema.safeParse({ date: "" }).success).toBe(false);
  });

  it("accepts only the two adjustment directions", () => {
    expect(
      workDayHoursInputSchema.safeParse({ date: "2026-10-05", direction: "UP" }).success,
    ).toBe(true);
    expect(
      workDayHoursInputSchema.safeParse({ date: "2026-10-05", direction: "DOWN" }).success,
    ).toBe(true);
    expect(
      workDayHoursInputSchema.safeParse({ date: "2026-10-05", direction: "SIDEWAYS" })
        .success,
    ).toBe(false);
    expect(workDayHoursInputSchema.safeParse({ direction: "UP" }).success).toBe(false);
  });
});

describe("nextWorkDayState", () => {
  it("cycles planned, then worked, then gone", () => {
    // The two levels of the feature: a click plans (the simulated budget), the next one
    // confirms the day as really worked, the third erases it.
    expect(nextWorkDayState(null)).toBe("PLANNED");
    expect(nextWorkDayState("PLANNED")).toBe("WORKED");
    expect(nextWorkDayState("WORKED")).toBe("REMOVE");
  });
});

describe("adjustWorkDayHours", () => {
  it("moves by half an hour", () => {
    expect(adjustWorkDayHours(new Decimal("7.5"), "UP").toFixed(2)).toBe("8.00");
    expect(adjustWorkDayHours(new Decimal("7.5"), "DOWN").toFixed(2)).toBe("7.00");
  });

  it("clamps at both bounds instead of wrapping or deleting", () => {
    expect(adjustWorkDayHours(new Decimal("0.5"), "DOWN").toFixed(2)).toBe("0.50");
    expect(adjustWorkDayHours(new Decimal("23.5"), "UP").toFixed(2)).toBe("24.00");
    expect(adjustWorkDayHours(new Decimal("24"), "UP").toFixed(2)).toBe("24.00");
  });
});

describe("computeSalarySummary", () => {
  const days: WorkDayRecord[] = [
    { date: new Date("2026-10-01T00:00:00.000Z"), status: "PLANNED", hours: new Decimal("7.5") },
    { date: new Date("2026-10-02T00:00:00.000Z"), status: "PLANNED", hours: new Decimal("7") },
    { date: new Date("2026-10-03T00:00:00.000Z"), status: "WORKED", hours: new Decimal("8") },
  ];

  it("keeps planned and worked hours apart, and totals them without double counting", () => {
    const summary = computeSalarySummary(days, new Decimal("20"));

    expect(summary.plannedHours.toFixed(2)).toBe("14.50");
    expect(summary.workedHours.toFixed(2)).toBe("8.00");
    expect(summary.totalHours.toFixed(2)).toBe("22.50");
    expect(summary.plannedAmount.toFixed(2)).toBe("290.00");
    expect(summary.workedAmount.toFixed(2)).toBe("160.00");
    expect(summary.totalAmount.toFixed(2)).toBe("450.00");
  });

  it("returns zeros for a month nobody clicked", () => {
    const summary = computeSalarySummary([], new Decimal("20.50"));

    expect(summary.totalHours.isZero()).toBe(true);
    expect(summary.totalAmount.isZero()).toBe(true);
  });
});

describe("salaryEquivalents", () => {
  it("derives day, 5-day week and month from the rate and the day length", () => {
    const equivalents = salaryEquivalents(new Decimal("20"), new Decimal("7"));

    expect(equivalents.daily.toFixed(2)).toBe("140.00");
    expect(equivalents.weekly.toFixed(2)).toBe("700.00");
    expect(equivalents.monthly.toFixed(2)).toBe("3033.33");
  });

  it("keeps the half-hour granularity of the day length", () => {
    const equivalents = salaryEquivalents(new Decimal("20"), new Decimal("7.5"));

    expect(equivalents.daily.toFixed(2)).toBe("150.00");
    expect(equivalents.weekly.toFixed(2)).toBe("750.00");
    expect(equivalents.monthly.toFixed(2)).toBe("3250.00");
  });
});

describe("resolveSalaryRate", () => {
  const rate = (year: number, month: number, hourlyRate: string) => ({
    year,
    month,
    hourlyRate: new Decimal(hourlyRate),
  });

  it("picks the exact month's change point", () => {
    const rates = [rate(2026, 8, "20.50"), rate(2026, 12, "22.00")];

    expect(resolveSalaryRate(rates, 2026, 12)?.hourlyRate.toFixed(2)).toBe("22.00");
  });

  it("keeps the previous rate until the next change point", () => {
    const rates = [rate(2026, 8, "20.50"), rate(2027, 1, "22.00")];

    expect(resolveSalaryRate(rates, 2026, 11)?.hourlyRate.toFixed(2)).toBe("20.50");
    expect(resolveSalaryRate(rates, 2027, 3)?.hourlyRate.toFixed(2)).toBe("22.00");
  });

  it("has no rate before the first change point: absent, not a default", () => {
    const rates = [rate(2026, 10, "20.50")];

    expect(resolveSalaryRate(rates, 2026, 9)).toBeNull();
    expect(resolveSalaryRate(rates, 2025, 12)).toBeNull();
  });

  it("does not depend on the order of the rows", () => {
    const rates = [rate(2027, 1, "22.00"), rate(2026, 8, "20.50")];

    expect(resolveSalaryRate(rates, 2026, 12)?.hourlyRate.toFixed(2)).toBe("20.50");
  });

  it("crosses the year boundary correctly", () => {
    const rates = [rate(2026, 11, "20.50"), rate(2027, 2, "22.00")];

    expect(resolveSalaryRate(rates, 2027, 1)?.hourlyRate.toFixed(2)).toBe("20.50");
  });
});

describe("salaryMonthContribution", () => {
  const rate = { hourlyRate: new Decimal("20.50"), currency: "EUR" as const };
  const workDay = (
    iso: string,
    hours: string,
    status: "PLANNED" | "WORKED" = "WORKED",
  ): WorkDayRecord => ({
    date: new Date(`${iso}T00:00:00.000Z`),
    status,
    hours: new Decimal(hours),
  });

  it("contributes the simulated total of clicked days as a pending income", () => {
    const contribution = salaryMonthContribution({
      rate,
      days: [workDay("2026-11-04", "7.5"), workDay("2026-11-05", "8", "PLANNED")],
      booking: null,
    });

    expect(contribution?.currency).toBe("EUR");
    expect(contribution?.type).toBe("INCOME");
    expect(contribution?.status).toBe("PENDING");
    // 15,5 h × 20,50 €, planned and worked each counted once.
    expect(contribution?.amount.toFixed(2)).toBe("317.75");
  });

  it("lets a registered month win over a later calendar edit", () => {
    const contribution = salaryMonthContribution({
      rate,
      days: [workDay("2026-11-04", "7.5")],
      booking: { amount: new Decimal("461.25"), currency: "EUR" },
    });

    expect(contribution?.status).toBe("CONFIRMED");
    expect(contribution?.amount.toFixed(2)).toBe("461.25");
  });

  it("contributes a registered salary even without a rate or a clicked day", () => {
    const contribution = salaryMonthContribution({
      rate: null,
      days: [],
      // The booking's own currency is used, not the (missing) rate's.
      booking: { amount: new Decimal("300.00"), currency: "USD" },
    });

    expect(contribution?.status).toBe("CONFIRMED");
    expect(contribution?.currency).toBe("USD");
  });

  it("contributes nothing without a clicked day — never a zero salary", () => {
    expect(salaryMonthContribution({ rate, days: [], booking: null })).toBeNull();
  });

  it("cannot simulate without a rate", () => {
    expect(
      salaryMonthContribution({
        rate: null,
        days: [workDay("2026-11-04", "7.5")],
        booking: null,
      }),
    ).toBeNull();
  });

  it("feeds the month's prévisionnel as income", () => {
    const salary = salaryMonthContribution({
      rate,
      days: [workDay("2026-11-04", "7.5")],
      booking: null,
    });
    const totals = summariseForecastMonth([
      {
        currency: "EUR",
        type: "EXPENSE",
        amount: new Decimal("950.00"),
        status: "PENDING",
      },
      ...(salary ? [salary] : []),
    ]);

    expect(totals).toHaveLength(1);
    expect(totals[0]?.income.toFixed(2)).toBe("153.75");
    expect(totals[0]?.expenses.toFixed(2)).toBe("950.00");
    expect(totals[0]?.net.toFixed(2)).toBe("-796.25");
    expect(totals[0]?.count).toBe(2);
  });
});

describe("monthCalendarCells", () => {
  it("pads October 2026 (starting on a Thursday) to complete weeks", () => {
    const cells = monthCalendarCells(2026, 10);

    // Monday-first grid: 3 leading blanks, 31 days, padded to 5 weeks.
    expect(cells.length).toBe(35);
    expect(cells.slice(0, 3)).toEqual([null, null, null]);
    expect(cells[3]).toBe("2026-10-01");
    expect(cells[33]).toBe("2026-10-31");
    expect(cells[34]).toBeNull();
  });

  it("handles a February starting on a Sunday", () => {
    const cells = monthCalendarCells(2026, 2);

    expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(cells[6]).toBe("2026-02-01");
    expect(cells.length).toBe(35);
  });

  it("needs no padding when the month starts on a Monday and fills its weeks", () => {
    // 28 days starting on a Monday: exactly four rows.
    const cells = monthCalendarCells(2027, 2);

    expect(cells[0]).toBe("2027-02-01");
    expect(cells.length).toBe(28);
    expect(cells.every((cell) => cell !== null)).toBe(true);
  });

  it("keeps every cell inside the requested month", () => {
    const cells = monthCalendarCells(2026, 10).filter((cell): cell is string => cell !== null);

    expect(cells).toHaveLength(31);
    expect(cells.every((cell) => cell.startsWith("2026-10-"))).toBe(true);
  });
});

describe("salaryBookingRef", () => {
  it("names one booking per month", () => {
    expect(salaryBookingRef(2026, 10)).toBe("salary:2026-10");
    expect(salaryBookingRef(2026, 1)).toBe("salary:2026-01");
  });

  it("gives another month another reference", () => {
    // The reference is what the unique (account, externalRef) uses to refuse a second
    // booking of the same month without refusing the next one.
    expect(salaryBookingRef(2026, 10)).not.toBe(salaryBookingRef(2026, 11));
  });
});

describe("salaryBookingInputSchema", () => {
  const validBooking = {
    month: "2026-10",
    accountId: "account-1",
    date: "2026-10-31",
  };

  it("parses the month, the account and the operation date", () => {
    const result = salaryBookingInputSchema.safeParse(validBooking);

    expect(result.success).toBe(true);
    expect(result.data?.month).toEqual({ year: 2026, month: 10 });
    expect(result.data?.date.toISOString()).toBe("2026-10-31T00:00:00.000Z");
  });

  it("refuses a missing account, an impossible date or an out-of-range month", () => {
    expect(
      salaryBookingInputSchema.safeParse({ ...validBooking, accountId: "" }).success,
    ).toBe(false);
    expect(
      salaryBookingInputSchema.safeParse({ ...validBooking, date: "2026-02-31" }).success,
    ).toBe(false);
    expect(
      salaryBookingInputSchema.safeParse({ ...validBooking, month: "2026-13" }).success,
    ).toBe(false);
  });

  it("carries no amount and no currency: the server recomputes both", () => {
    const result = salaryBookingInputSchema.safeParse({
      ...validBooking,
      amount: "9999",
      currency: "USD",
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("amount");
    expect(result.data).not.toHaveProperty("currency");
  });
});
