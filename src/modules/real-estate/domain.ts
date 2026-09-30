import Decimal from "decimal.js";
import { z } from "zod";
import type { Currency } from "@/lib/money";
import { currencyCode, optionalAmount, optionalDate, optionalId, optionalText } from "@/lib/validation";

/**
 * Real-estate module.
 *
 * A property is not assumed to be rented: `occupancy` is explicit and a vacant
 * property simply carries no rental income.
 *
 * ## Double-counting rule
 *
 * A cashflow entry describes either a linked transaction or a standalone amount,
 * never both. When a transaction is linked, **the transaction is the single
 * source of truth** and the entry stores no amount of its own; otherwise the
 * same money would be counted twice in the property totals. `resolveCashflowAmount`
 * implements that rule and both cases are covered by tests.
 */

export const PROPERTY_OCCUPANCIES = [
  "RENTED",
  "VACANT",
  "OWNER_OCCUPIED",
  "SEASONAL",
  "OTHER",
] as const;
export type PropertyOccupancy = (typeof PROPERTY_OCCUPANCIES)[number];

export const CASHFLOW_KINDS = ["INCOME", "EXPENSE"] as const;
export type CashflowKind = (typeof CASHFLOW_KINDS)[number];

export type CashflowEntry = {
  id: string;
  kind: CashflowKind;
  label: string;
  currency: Currency;
  /** Set for a standalone entry, null when a transaction is linked. */
  amount: Decimal | null;
  dueDate: Date | null;
  settledAt: Date | null;
  transaction: {
    id: string;
    label: string;
    amount: Decimal;
  } | null;
};

export type PropertySummary = {
  id: string;
  name: string;
  address: string | null;
  occupancy: PropertyOccupancy;
  purchaseDate: Date | null;
  saleDate: Date | null;
  notes: string | null;
  cashflowCount: number;
  income: Decimal;
  expenses: Decimal;
  net: Decimal;
  currency: Currency;
};

export class UnresolvedCashflowError extends Error {
  constructor(cashflowId: string) {
    super(
      `Cashflow ${cashflowId} has neither a linked transaction nor an amount: it cannot contribute to a total.`,
    );
    this.name = "UnresolvedCashflowError";
  }
}

/** Returns the amount a cashflow contributes, once and only once. */
export function resolveCashflowAmount(entry: CashflowEntry): Decimal {
  if (entry.transaction) {
    return entry.transaction.amount;
  }

  if (entry.amount) {
    return entry.amount;
  }

  throw new UnresolvedCashflowError(entry.id);
}

export type PropertyTotals = {
  currency: Currency;
  income: Decimal;
  expenses: Decimal;
  net: Decimal;
};

/**
 * Totals for one property.
 *
 * `income` sums INCOME entries, `expenses` reports EXPENSE entries as a positive
 * number, and `net` is `income - expenses`. Each entry counts exactly once even
 * when it is linked to a transaction that also appears in the budget.
 */
export function computePropertyTotals(
  entries: readonly CashflowEntry[],
  options: { currency?: Currency } = {},
): PropertyTotals {
  const currency = options.currency ?? entries[0]?.currency ?? "EUR";

  let income = new Decimal(0);
  let expenses = new Decimal(0);

  for (const entry of entries) {
    if (entry.currency !== currency) {
      throw new Error(
        `Cannot total ${entry.currency} and ${currency} for one property: filter by currency first.`,
      );
    }

    const amount = resolveCashflowAmount(entry);

    if (entry.kind === "INCOME") {
      income = income.plus(amount);
    } else {
      expenses = expenses.plus(amount.abs());
    }
  }

  return { currency, income, expenses, net: income.minus(expenses) };
}

/**
 * True when a cashflow is due before `today` and has not been settled.
 * A property may legitimately have no due date: such an entry is never overdue.
 */
export function isCashflowOverdue(
  entry: Pick<CashflowEntry, "dueDate" | "settledAt">,
  today: Date,
): boolean {
  if (!entry.dueDate || entry.settledAt) {
    return false;
  }

  return entry.dueDate.getTime() < today.getTime();
}

export const propertyInputSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis.").max(120),
  address: optionalText(300, "L'adresse est limitée à 300 caractères."),
  occupancy: z.enum(PROPERTY_OCCUPANCIES).default("VACANT"),
  purchaseDate: optionalDate,
  saleDate: optionalDate,
  notes: optionalText(2000, "Les notes sont limitées à 2000 caractères."),
});

export type PropertyInput = z.input<typeof propertyInputSchema>;
export type ValidatedPropertyInput = z.output<typeof propertyInputSchema>;

/**
 * Input contract for a cashflow entry.
 *
 * Exactly one of `amount` and `transactionId` is required, which is what keeps a
 * linked transaction from being counted twice (see the double-counting rule
 * above). `currency` is optional: for a linked entry the action reads it from the
 * transaction, so a property total can never mix two currencies.
 */
export const cashflowInputSchema = z
  .object({
    propertyId: z.string().trim().min(1, "Un bien est requis."),
    kind: z.enum(CASHFLOW_KINDS),
    label: z.string().trim().min(1, "Le libellé est requis.").max(200),
    /** Standalone entries only. */
    amount: optionalAmount,
    /** Links the entry to an existing transaction instead of declaring an amount. */
    transactionId: optionalId,
    currency: currencyCode.optional(),
    dueDate: optionalDate,
    settledAt: optionalDate,
    notes: optionalText(2000, "Les notes sont limitées à 2000 caractères."),
  })
  .refine((value) => Boolean(value.amount) !== Boolean(value.transactionId), {
    message:
      "Renseignez soit un montant, soit une transaction liée : jamais les deux, sinon la somme serait comptée deux fois.",
    path: ["amount"],
  });

export type CashflowInput = z.input<typeof cashflowInputSchema>;
export type ValidatedCashflowInput = z.output<typeof cashflowInputSchema>;
