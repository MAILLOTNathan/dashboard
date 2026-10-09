import Decimal from "decimal.js";
import { z } from "zod";
import { monthRange, toDateOnlyString } from "@/lib/dates";
import { DEFAULT_CURRENCY, toDecimalString, type Currency } from "@/lib/money";
import { amount, optionalDate, optionalId, requiredDate } from "@/lib/validation";

/**
 * Recurring forecasts: expected income and expenses, and the occurrences they produce
 * (BP-03).
 *
 * A definition describes a series — a label, a positive magnitude, a direction
 * (`INCOME`/`EXPENSE`), an account, an optional category, a monthly cadence and a date
 * range. It writes **nothing** to the ledger: opening a month materialises one
 * occurrence per due date, and each occurrence must be decided explicitly.
 *
 * - Confirming reuses the manual creation rules (see `resolveTransactionInput`) and
 *   dates the transaction on the occurrence day, with the stable external reference
 *   `forecast:{occurrenceId}` so a replay cannot book it twice.
 * - Skipping (« Passer ») and dismissing (« Écarter ») record a decision of their own
 *   and create no transaction; both stay visible in the month's decisions.
 *
 * Until a confirmation, forecast amounts appear in no total: monthly totals and every
 * budget figure read the `Transaction` table only.
 *
 * Day-of-month rule: an occurrence falls on the start date's day of month, clamped to
 * the month's last day when it is shorter (the 31st → 28/29 February, 30 April). The
 * clamp never propagates: March still falls on the 31st.
 *
 * Cadence rule: `MONTHLY` occurs every month, `QUARTERLY` every third month and
 * `YEARLY` in the start month only — always counted from the start date's month, so a
 * series started in February is quarterly in May, August, November, and yearly in
 * February. A month that does not align with the cadence holds no occurrence.
 *
 * Dates are calendar days with no time and no time zone, stored as `DATE` at UTC
 * midnight like every operation date; "today" and the default month follow the same
 * UTC calendar (`currentMonthKey`), the convention used by every monthly window.
 */

export const RECURRENCE_FREQUENCIES = ["MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export const RECURRENCE_FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  MONTHLY: "Mensuelle",
  QUARTERLY: "Trimestrielle",
  YEARLY: "Annuelle",
};

/** How many months apart the occurrences of a cadence are. */
const FREQUENCY_STEP_MONTHS: Record<RecurrenceFrequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
};

/** A forecast is an income or an expense — never a transfer, which carries no category. */
export const FORECAST_TYPES = ["INCOME", "EXPENSE"] as const;
export type ForecastType = (typeof FORECAST_TYPES)[number];

export const RECURRING_OCCURRENCE_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "SKIPPED",
  "DISMISSED",
] as const;
export type RecurringOccurrenceStatus = (typeof RECURRING_OCCURRENCE_STATUSES)[number];

export type RecurringEntryRecord = {
  id: string;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  type: ForecastType;
  label: string;
  /** Planned magnitude, always positive; the sign comes from `type` at confirmation. */
  amount: Decimal;
  frequency: RecurrenceFrequency;
  /** First day of the series, a calendar day at UTC midnight. */
  startDate: Date;
  /** Last day of the series, inclusive; `null` means no end. */
  endDate: Date | null;
};

export type RecurringOccurrenceRecord = {
  id: string;
  recurringId: string;
  /** Calendar day at UTC midnight. */
  date: Date;
  status: RecurringOccurrenceStatus;
  /** Set by the confirmation: the transaction it created. */
  transactionId: string | null;
  /** When the decision was taken; `null` while pending. */
  decidedAt: Date | null;
};

/** One (definition, date) pair a month should contain. */
export type PlannedOccurrence = {
  recurringId: string;
  date: Date;
};

/** Last calendar day of a month, as a number. Day 0 of the next month is the last. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The occurrence dates of one definition inside one month.
 *
 * The candidate is the start date's day of month, clamped to the month's length, and
 * only when the month aligns with the cadence (see the header). A candidate before the
 * series' start (a definition starting on the 15th never occurs on the 1st) or after
 * its inclusive end date is dropped, so a finished series produces nothing.
 */
export function occurrenceDatesForMonth(
  entry: Pick<RecurringEntryRecord, "startDate" | "endDate" | "frequency">,
  year: number,
  month: number,
): Date[] {
  // Validates the month and documents the window convention in one call.
  monthRange(year, month);

  const monthsSinceStart =
    (year - entry.startDate.getUTCFullYear()) * 12 +
    ((month - 1) - entry.startDate.getUTCMonth());

  if (monthsSinceStart < 0) {
    return [];
  }

  if (monthsSinceStart % FREQUENCY_STEP_MONTHS[entry.frequency] !== 0) {
    return [];
  }

  const day = entry.startDate.getUTCDate();
  const candidate = new Date(Date.UTC(year, month - 1, Math.min(day, lastDayOfMonth(year, month))));

  if (candidate.getTime() < entry.startDate.getTime()) {
    return [];
  }
  if (entry.endDate !== null && candidate.getTime() > entry.endDate.getTime()) {
    return [];
  }

  return [candidate];
}

/**
 * Every occurrence a month should contain, for a set of definitions.
 *
 * Materialisation is idempotent: the caller writes these rows with `skipDuplicates`
 * against the unique (recurringId, date), so re-opening a month never duplicates an
 * occurrence — and never revives a decided one, which still holds its row.
 */
export function plannedOccurrences(
  entries: readonly RecurringEntryRecord[],
  year: number,
  month: number,
): PlannedOccurrence[] {
  return entries.flatMap((entry) =>
    occurrenceDatesForMonth(entry, year, month).map((date) => ({
      recurringId: entry.id,
      date,
    })),
  );
}

/** The movement a confirmation writes: an expense is negative, an income positive. */
export function signedForecastAmount(type: ForecastType, planned: Decimal): Decimal {
  return type === "EXPENSE" ? planned.negated() : planned;
}

/** One expected movement considered by the month's prévisionnel summary. */
export type ForecastContribution = {
  currency: Currency;
  type: ForecastType;
  /** Positive magnitude, like the definition; `type` carries the direction. */
  amount: Decimal;
  status: RecurringOccurrenceStatus;
};

export type ForecastMonthTotal = {
  currency: Currency;
  /** Expected income, positive. */
  income: Decimal;
  /** Expected expenses, as a positive magnitude (the `computeMonthlyTotals` shape). */
  expenses: Decimal;
  /** income − expenses. */
  net: Decimal;
  /** Counted movements, confirmed ones included. */
  count: number;
  confirmedCount: number;
};

/**
 * The month's prévisionnel totals, per currency — expected income, expenses and net.
 *
 * The expected movements are handed in as contributions, whatever their source: the
 * series échéances and the salary prévision of the month both qualify. A **pending**
 * contribution counts, and so does a **confirmed** one — a prévision that came true is
 * still part of what the month was expected to be, and the count keeps that visible.
 * A **skipped** or **dismissed** one does not: those states are precisely the statement
 * that it did not count. Currencies are never converted, and these totals never feed an
 * actual total — only recorded transactions do.
 */
export function summariseForecastMonth(
  contributions: readonly ForecastContribution[],
): ForecastMonthTotal[] {
  const totals = new Map<string, ForecastMonthTotal>();

  for (const contribution of contributions) {
    if (contribution.status === "SKIPPED" || contribution.status === "DISMISSED") {
      continue;
    }

    // Strict comparison on purpose: decimal.js zero is not "negative", and an amount
    // of zero contributes nothing either way.
    const signed = signedForecastAmount(contribution.type, contribution.amount);
    const isExpense = signed.lessThan(0);
    const confirmed = contribution.status === "CONFIRMED" ? 1 : 0;
    const existing = totals.get(contribution.currency);

    if (existing) {
      if (isExpense) {
        existing.expenses = existing.expenses.plus(signed.negated());
      } else {
        existing.income = existing.income.plus(signed);
      }
      existing.net = existing.income.minus(existing.expenses);
      existing.count += 1;
      existing.confirmedCount += confirmed;
    } else {
      totals.set(contribution.currency, {
        currency: contribution.currency,
        income: isExpense ? new Decimal(0) : signed,
        expenses: isExpense ? signed.negated() : new Decimal(0),
        net: signed,
        count: 1,
        confirmedCount: confirmed,
      });
    }
  }

  return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * Stable import reference of a confirmed occurrence (stored as `Transaction.externalRef`).
 *
 * The unique (accountId, externalRef) is what makes a confirmation idempotent: a
 * replayed request fails instead of booking the same occurrence twice, exactly like
 * the salary booking.
 */
export function forecastOccurrenceRef(occurrenceId: string): string {
  return `forecast:${occurrenceId}`;
}
/**
 * Why the start date of a series cannot change, or `null` when it can.
 *
 * Once an occurrence has been decided, the series' history is dated: moving the start
 * date would re-date a story that was already told (and may hold a transaction). Until
 * the first decision, the start date — and the cadence built on it — can still move;
 * the caller clears the pending occurrences for them to be re-materialised on the new
 * rule.
 */
export function startDateChangeRefusedReason(decidedCount: number): string | null {
  if (decidedCount === 0) {
    return null;
  }

  return "La date de début ne peut plus changer : des échéances de cette série ont déjà été confirmées, passées ou écartées, et leur historique est daté.";
}

/**
 * The expected contributions of a month for series that are not materialised yet (the
 * upcoming-months planner): every planned occurrence counts as pending. The currency is
 * resolved through the account, like everywhere else.
 */
export function plannedContributions(
  entries: readonly RecurringEntryRecord[],
  year: number,
  month: number,
  currencyByAccount: ReadonlyMap<string, Currency>,
): ForecastContribution[] {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));

  return plannedOccurrences(entries, year, month).flatMap((planned) => {
    const entry = entriesById.get(planned.recurringId);

    if (!entry) {
      return [];
    }

    return [
      {
        currency: currencyByAccount.get(entry.accountId) ?? DEFAULT_CURRENCY,
        type: entry.type,
        amount: entry.amount,
        status: "PENDING" as const,
      },
    ];
  });
}
/** Shared by the pre-check and the unique-constraint path of a confirmation. */
export const ALREADY_CONFIRMED_MESSAGE =
  "Cette échéance est déjà confirmée : rechargez la page pour voir la décision enregistrée.";

/**
 * Why this occurrence cannot be decided, or `null` when it can.
 *
 * A decision is terminal: a confirmed, skipped or dismissed occurrence keeps its state
 * (and its decision date) so the audit trail never rewrites itself.
 */
export function decisionBlockedReason(status: RecurringOccurrenceStatus): string | null {
  if (status === "PENDING") {
    return null;
  }

  if (status === "CONFIRMED") {
    return ALREADY_CONFIRMED_MESSAGE;
  }

  const label = status === "SKIPPED" ? "déjà passée" : "déjà écartée";
  return `Cette échéance est ${label} : rechargez la page pour voir la décision enregistrée.`;
}

export const OCCURRENCE_STATUS_LABELS: Record<RecurringOccurrenceStatus, string> = {
  PENDING: "À traiter",
  CONFIRMED: "Confirmée",
  SKIPPED: "Passée",
  DISMISSED: "Écartée",
};

/**
 * Input contract for a recurring definition.
 *
 * The amount is asked positive, like a budget: it describes what is expected, and the
 * direction comes from the type. An end date before the start date is refused here, so
 * an empty series cannot be stored at all.
 */
const recurringEntryBaseSchema = z.object({
  accountId: z.string().trim().min(1, "Un compte est requis."),
  categoryId: optionalId,
  type: z.enum(FORECAST_TYPES),
  label: z.string().trim().min(1, "Le libellé est requis.").max(200),
  amount: amount.refine(
    (value) => value.greaterThan(0),
    "Le montant prévu doit être supérieur à zéro : il décrit ce qui est attendu, pas le sens du mouvement.",
  ),
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  startDate: requiredDate,
  endDate: optionalDate,
});

function endDateAfterStart(value: { startDate: Date; endDate: Date | null }): boolean {
  return value.endDate === null || value.endDate.getTime() >= value.startDate.getTime();
}

const END_DATE_RULE = {
  message: "La date de fin ne peut pas précéder la date de début.",
  path: ["endDate"],
};

export const recurringEntryInputSchema = recurringEntryBaseSchema.refine(
  endDateAfterStart,
  END_DATE_RULE,
);

export type RecurringEntryInput = z.input<typeof recurringEntryInputSchema>;
export type ValidatedRecurringEntryInput = z.output<typeof recurringEntryInputSchema>;

/**
 * The creation fields plus the identifier of the row being edited — the same rules, so
 * an edition can never accept what a creation refuses.
 */
export const recurringEntryUpdateSchema = recurringEntryBaseSchema
  .extend({ id: z.string().trim().min(1, "Identifiant manquant.") })
  .refine(endDateAfterStart, END_DATE_RULE);

export type RecurringEntryUpdateValues = z.input<typeof recurringEntryUpdateSchema>;
export type ValidatedRecurringEntryUpdate = z.output<typeof recurringEntryUpdateSchema>;

/**
 * A series prepared for the form — strings only, like every other form contract: a
 * `Decimal` or a `Date` cannot cross the server/client boundary.
 */
export type RecurringEntryFormInitialValues = {
  id: string;
  accountId: string;
  categoryId: string;
  type: ForecastType;
  label: string;
  amount: string;
  frequency: RecurrenceFrequency;
  /** `YYYY-MM-DD`. */
  startDate: string;
  /** `YYYY-MM-DD`, empty when the series has no end. */
  endDate: string;
};

export function toRecurringEntryFormInitialValues(
  record: RecurringEntryRecord,
): RecurringEntryFormInitialValues {
  return {
    id: record.id,
    accountId: record.accountId,
    categoryId: record.categoryId ?? "",
    type: record.type,
    label: record.label,
    amount: toDecimalString(record.amount),
    frequency: record.frequency,
    startDate: toDateOnlyString(record.startDate),
    endDate: record.endDate === null ? "" : toDateOnlyString(record.endDate),
  };
}
