import Decimal from "decimal.js";
import { z } from "zod";
import { monthRange, toDateOnlyString } from "@/lib/dates";
import { parseAmountInput, type Currency } from "@/lib/money";
import { amount, currencyCode, requiredDate } from "@/lib/validation";
import { budgetMonthKey, budgetMonthSchema } from "./domain";

/**
 * Salary simulation: a wage, and a calendar of days that are planned then worked.
 *
 * The owner enters **one** figure — an hourly rate — and clicks days on a month calendar.
 * A day has two levels, expressed by its status: the first click plans it (it feeds the
 * simulated budget), the second marks it really worked (it feeds the amount actually
 * earned), and a third click removes it. The two states are disjoint, so a total never
 * counts the same day twice.
 *
 * Everything the simulation produces is a figure on this page. Writing it into the
 * accounts is a deliberate, separate gesture: the booking button turns the month's
 * worked hours into one real INCOME transaction (category « Salaire », created when the
 * owner does not have it yet), and nothing else ever leaves the simulator. That keeps the
 * simulation free of the double counting an automatic entry would cause.
 *
 * The rate is stored hourly on purpose. Weekly and monthly equivalents are derived
 * figures (`salaryEquivalents`), computed from the configured day length and a
 * **5-day week**; they are displayed but never stored, so no rounded conversion can
 * drift from the rate the owner typed.
 */

export const WORK_DAY_STATUSES = ["PLANNED", "WORKED"] as const;
export type WorkDayStatus = (typeof WORK_DAY_STATUSES)[number];

/** What a click on a day does, given its current state. */
export type WorkDayTransition = "PLANNED" | "WORKED" | "REMOVE";

/** Hours of a clicked day: half-hour steps, never zero (the third click removes it). */
export const WORK_DAY_HOUR_STEP = new Decimal("0.5");
export const MIN_WORK_DAY_HOURS = new Decimal("0.5");
export const MAX_WORK_DAY_HOURS = new Decimal(24);

/** Convention behind the derived weekly/monthly figures. Documented, not configurable. */
export const WORK_DAYS_PER_WEEK = 5;

export type SalarySettingRecord = {
  hourlyRate: Decimal;
  /** Default length of a plannable day, applied to future clicks only. */
  hoursPerDay: Decimal;
  currency: Currency;
};

export type WorkDayRecord = {
  /** Calendar day at UTC midnight, like every operation date. */
  date: Date;
  status: WorkDayStatus;
  hours: Decimal;
};

export type SalarySummary = {
  plannedHours: Decimal;
  workedHours: Decimal;
  totalHours: Decimal;
  /** Planned hours × rate: the budget associated with the schedule. */
  plannedAmount: Decimal;
  /** Worked hours × rate: what has actually been earned. */
  workedAmount: Decimal;
  /** Planned + worked: the two states are disjoint, so this counts each day once. */
  totalAmount: Decimal;
};

/**
 * What the next click on a day means.
 *
 * `null` is a day nobody clicked yet. The cycle is deliberate: a plan becomes a fact,
 * and a third click erases the day rather than leaving a state the owner cannot undo.
 */
export function nextWorkDayState(current: WorkDayStatus | null): WorkDayTransition {
  if (current === null) {
    return "PLANNED";
  }

  return current === "PLANNED" ? "WORKED" : "REMOVE";
}

/**
 * Moves the hours of a day one half-hour step, clamped to [0.5 h, 24 h].
 *
 * A day at the bound simply stays there: removing a day is the third click's job, so
 * the buttons never surprise the owner by deleting or wrapping around.
 */
export function adjustWorkDayHours(hours: Decimal, direction: "UP" | "DOWN"): Decimal {
  const next =
    direction === "UP" ? hours.plus(WORK_DAY_HOUR_STEP) : hours.minus(WORK_DAY_HOUR_STEP);

  if (next.lessThan(MIN_WORK_DAY_HOURS)) {
    return MIN_WORK_DAY_HOURS;
  }
  if (next.greaterThan(MAX_WORK_DAY_HOURS)) {
    return MAX_WORK_DAY_HOURS;
  }

  return next;
}

/**
 * The month's figures, from the clicked days and the rate.
 *
 * Amounts are exact Decimal products of hours and the rate; they are only ever displayed,
 * never stored, so no rounding happens here.
 */
export function computeSalarySummary(
  days: readonly WorkDayRecord[],
  hourlyRate: Decimal,
): SalarySummary {
  let plannedHours = new Decimal(0);
  let workedHours = new Decimal(0);

  for (const day of days) {
    if (day.status === "PLANNED") {
      plannedHours = plannedHours.plus(day.hours);
    } else {
      workedHours = workedHours.plus(day.hours);
    }
  }

  const totalHours = plannedHours.plus(workedHours);

  return {
    plannedHours,
    workedHours,
    totalHours,
    plannedAmount: plannedHours.times(hourlyRate),
    workedAmount: workedHours.times(hourlyRate),
    totalAmount: totalHours.times(hourlyRate),
  };
}

/**
 * Derived day/week/month amounts, for information only.
 *
 * Day = rate × hours per day; week = day × 5 (five-day week); month = week × 52/12.
 * The UI labels these as indicative equivalents: they describe the schedule entered, they
 * are not a payslip, and they are never stored.
 */
export function salaryEquivalents(
  hourlyRate: Decimal,
  hoursPerDay: Decimal,
): { daily: Decimal; weekly: Decimal; monthly: Decimal } {
  const round = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const daily = hourlyRate.times(hoursPerDay);
  const weekly = daily.times(WORK_DAYS_PER_WEEK);

  return {
    daily: round(daily),
    weekly: round(weekly),
    monthly: round(weekly.times(52).dividedBy(12)),
  };
}

const HOURS_MESSAGE = "Heures invalides : attendu un nombre entre 0 et 24 (ex. 7 ou 7,5).";

/**
 * A hand-typed number of hours.
 *
 * Reuses the amount parser (comma or dot, at most two decimals) so hours accept exactly
 * what every other numeric field accepts, then bounds them to a plausible day. A message
 * of its own because "Montant invalide" would be wrong on an hours field.
 */
export const hoursPerDaySchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    let parsed: Decimal;
    try {
      parsed = parseAmountInput(value);
    } catch {
      ctx.addIssue({ code: "custom", message: HOURS_MESSAGE });
      return z.NEVER;
    }

    if (!parsed.greaterThan(0) || parsed.greaterThan(MAX_WORK_DAY_HOURS)) {
      ctx.addIssue({ code: "custom", message: HOURS_MESSAGE });
      return z.NEVER;
    }

    return parsed;
  });

/** The wage of this owner. One setting per owner, so the form is an upsert. */
export const salarySettingInputSchema = z.object({
  hourlyRate: amount.refine(
    (value) => value.greaterThan(0),
    "Le taux horaire doit être supérieur à zéro.",
  ),
  hoursPerDay: hoursPerDaySchema,
  currency: currencyCode,
});

export type SalarySettingInput = z.input<typeof salarySettingInputSchema>;
export type ValidatedSalarySettingInput = z.output<typeof salarySettingInputSchema>;

/** Payload of one calendar click: the day it targets. */
export const workDayInputSchema = z.object({
  date: requiredDate,
});

export type WorkDayInput = z.input<typeof workDayInputSchema>;
export type ValidatedWorkDayInput = z.output<typeof workDayInputSchema>;

/** Payload of an hours adjustment: the day, and which way the half-hour goes. */
export const workDayHoursInputSchema = z.object({
  date: requiredDate,
  direction: z.enum(["UP", "DOWN"]),
});

export type WorkDayHoursInput = z.input<typeof workDayHoursInputSchema>;
export type ValidatedWorkDayHoursInput = z.output<typeof workDayHoursInputSchema>;

/** Name of the category a booked salary lands in; created on demand when missing. */
export const SALARY_CATEGORY_NAME = "Salaire";

/**
 * Stable import reference of one month's salary booking.
 *
 * Stored as `Transaction.externalRef`, it is what makes the booking idempotent: the
 * unique (accountId, externalRef) refuses a second entry for the same month, and the
 * salary tab can tell "already recorded" from "to record" without matching on a label
 * the owner may have edited afterwards.
 */
export function salaryBookingRef(year: number, month: number): string {
  return `salary:${budgetMonthKey(year, month)}`;
}

/** Message shared by the pre-check and the constraint-violation path of a booking. */
export const DUPLICATE_SALARY_BOOKING_MESSAGE =
  "La recette de ce mois est déjà enregistrée.";

/** Fields the booking form edits: the account to credit, and the operation date. */
export const salaryBookingFormSchema = z.object({
  accountId: z.string().trim().min(1, "Un compte est requis."),
  date: requiredDate,
});

export type SalaryBookingFormValues = z.input<typeof salaryBookingFormSchema>;
export type ValidatedSalaryBookingForm = z.output<typeof salaryBookingFormSchema>;

/**
 * Payload of a booking: the form fields plus the month whose worked hours are recorded.
 *
 * The amount is deliberately absent: it is recomputed on the server from the month's
 * worked days, so a replayed request cannot book a figure the calendar never produced.
 * The currency is absent too — the transaction takes its account's, and the action
 * refuses an account in another currency instead of converting.
 */
export const salaryBookingInputSchema = salaryBookingFormSchema.extend({
  month: budgetMonthSchema,
});

export type SalaryBookingInput = z.input<typeof salaryBookingInputSchema>;
export type ValidatedSalaryBookingInput = z.output<typeof salaryBookingInputSchema>;

/**
 * The month's cells, Monday-first, padded to complete weeks.
 *
 * `null` marks a cell outside the month. The grid is built here rather than in the
 * component so its geometry (leading offset, leap Februaries, full last row) is testable
 * without a browser.
 */
export function monthCalendarCells(year: number, month: number): (string | null)[] {
  const { start, end } = monthRange(year, month);
  const daysInMonth = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  // `getUTCDay()` is 0 for Sunday; the grid starts on Monday.
  const leadingBlanks = (start.getUTCDay() + 6) % 7;

  const cells: (string | null)[] = Array.from({ length: leadingBlanks }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toDateOnlyString(new Date(Date.UTC(year, month - 1, day))));
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}
