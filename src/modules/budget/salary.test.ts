import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  adjustWorkDayHours,
  computeSalarySummary,
  hoursPerDaySchema,
  monthCalendarCells,
  nextWorkDayState,
  salaryBookingInputSchema,
  salaryBookingRef,
  salaryEquivalents,
  salarySettingInputSchema,
  workDayHoursInputSchema,
  workDayInputSchema,
  type WorkDayRecord,
} from "./salary";

/** Fictitious values only. */

describe("salarySettingInputSchema", () => {
  const validSetting = {
    hourlyRate: "20,50",
    hoursPerDay: "7,5",
    currency: "EUR",
  };

  it("parses a hand-typed rate and day length into exact decimals", () => {
    const result = salarySettingInputSchema.safeParse(validSetting);

    expect(result.success).toBe(true);
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
