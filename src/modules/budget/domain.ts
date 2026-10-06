import Decimal from "decimal.js";
import { z } from "zod";
import { parseMonthKey, toDateOnlyString } from "@/lib/dates";
import { toDecimalString, type Currency } from "@/lib/money";
import {
  amount,
  currencyCode,
  optionalId,
  optionalText,
  requiredDate,
} from "@/lib/validation";

/**
 * Budget module: accounts, categories, transactions and monthly budgets.
 *
 * Signs are meaningful: an outflow is stored as a negative amount. The
 * transaction type stays explicit so that a transfer is never mistaken for an
 * expense (see `computeMonthlyTotals` for the resulting aggregation rules).
 */

export const ACCOUNT_TYPES = [
  "CHECKING",
  "SAVINGS",
  "CASH",
  "CREDIT_CARD",
  "OTHER",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CATEGORY_KINDS = ["INCOME", "EXPENSE"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const TRANSACTION_TYPES = ["INCOME", "EXPENSE", "TRANSFER"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const DEFAULT_CURRENCY_CODE: Currency = "EUR";

export type TransactionRecord = {
  id: string;
  type: TransactionType;
  /** Signed amount, in the account currency. */
  amount: Decimal;
  currency: Currency;
  /** Calendar day of the operation, distinct from creation and synchronisation. */
  operationDate: Date;
  label: string;
  accountId: string;
  accountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  notes: string | null;
  externalRef: string | null;
  /** Instant the row was written, distinct from `operationDate` (a calendar day). */
  createdAt: Date;
};

export type AccountSummary = {
  id: string;
  name: string;
  type: AccountType;
  currency: Currency;
};

export type CategorySummary = {
  id: string;
  name: string;
  kind: CategoryKind;
};

export function isTransfer(transaction: Pick<TransactionRecord, "type">): boolean {
  return transaction.type === "TRANSFER";
}

/**
 * The category kind a transaction type may use.
 *
 * A transaction and its category must tell the same story: an `EXPENSE` on an
 * `INCOME` category (or the reverse) would be counted in the wrong place by every
 * filter and every report built on `kind`, without anything failing visibly.
 *
 * A transfer returns `null` on purpose: moving money between two of your own
 * accounts is neither a receipt nor a cost, transfers are already excluded from the
 * monthly totals, so no category applies and the form does not offer one.
 */
export function categoryKindForTransactionType(type: TransactionType): CategoryKind | null {
  if (type === "TRANSFER") {
    return null;
  }

  return type === "INCOME" ? "INCOME" : "EXPENSE";
}

/**
 * Why this category cannot be used with this transaction type, or `null` when it can.
 *
 * `null` means "no category chosen", which is always valid: a category is optional.
 *
 * The form filters the list, so this only ever answers a request that did not come
 * from the rendered form — a replayed body, or a category whose kind changed in
 * another tab. Returning the reason rather than a boolean keeps the message in the
 * module, next to the rule it explains.
 */
export function categoryMismatchReason(
  type: TransactionType,
  category: Pick<CategorySummary, "kind"> | null,
): string | null {
  if (category === null) {
    return null;
  }

  const expected = categoryKindForTransactionType(type);

  if (expected === null) {
    return "Un transfert entre comptes ne porte pas de catégorie.";
  }

  if (category.kind !== expected) {
    return "Cette catégorie n'est pas du même type que l'opération : une recette utilise une catégorie de recette, une dépense une catégorie de dépense.";
  }

  return null;
}

/**
 * Input contract for a manually tracked account.
 *
 * No banking credential is ever part of this contract: the dashboard tracks
 * balances the owner types in (see AGENTS.md).
 */
export const accountInputSchema = z.object({
  name: z.string().trim().min(1, "Le nom du compte est requis.").max(120),
  type: z.enum(ACCOUNT_TYPES),
  currency: currencyCode,
});

export type AccountInput = z.input<typeof accountInputSchema>;
export type ValidatedAccountInput = z.output<typeof accountInputSchema>;

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Le nom de la catégorie est requis.").max(120),
  kind: z.enum(CATEGORY_KINDS),
});

export type CategoryInput = z.input<typeof categoryInputSchema>;
export type ValidatedCategoryInput = z.output<typeof categoryInputSchema>;

/**
 * Input contract for a transaction, validated before it reaches the database.
 * Shared by the server actions and the spreadsheet view.
 *
 * The sign is part of the meaning: an outflow is negative. A positive amount on
 * an EXPENSE transaction is a reimbursement, which is why the sign is asked for
 * rather than derived from the type.
 */
export const transactionInputSchema = z.object({
  accountId: z.string().trim().min(1, "Un compte est requis."),
  categoryId: optionalId,
  type: z.enum(TRANSACTION_TYPES),
  label: z.string().trim().min(1, "Le libellé est requis.").max(200),
  amount,
  currency: currencyCode,
  operationDate: requiredDate,
  notes: optionalText(2000, "Les notes sont limitées à 2000 caractères."),
});

export type TransactionInput = z.input<typeof transactionInputSchema>;
export type ValidatedTransactionInput = z.output<typeof transactionInputSchema>;

/**
 * Form contract for a transaction.
 *
 * The currency is deliberately absent: a transaction is denominated in the
 * currency of its account, so the server reads it from the account instead of
 * asking for a second field that could contradict it.
 */
export const transactionFormSchema = transactionInputSchema.omit({ currency: true });

export type TransactionFormValues = z.input<typeof transactionFormSchema>;
export type ValidatedTransactionForm = z.output<typeof transactionFormSchema>;

/**
 * Payload for editing an existing transaction.
 *
 * The creation fields plus the identifier of the row, and nothing else: an edition is
 * not a second kind of transaction, and a contract of its own would let the two drift
 * apart until an edition accepts what a creation refuses. No owner identifier travels
 * here — the action scopes the update with the session, so a replayed identifier cannot
 * reach another account.
 */
export const transactionUpdateSchema = transactionFormSchema.extend({
  id: z.string().trim().min(1, "Identifiant manquant."),
});

export type TransactionUpdateValues = z.input<typeof transactionUpdateSchema>;
export type ValidatedTransactionUpdate = z.output<typeof transactionUpdateSchema>;

/**
 * A transaction prepared for the entry form.
 *
 * Strings only, and deliberately so: a `Decimal` or a `Date` cannot cross the
 * server/client boundary — React refuses to serialise them, and the client would receive
 * an object whose methods are gone (`value.toFixed is not a function`). The conversion
 * happens on the server, next to the value that actually holds the precision.
 */
export type TransactionFormInitialValues = {
  id: string;
  accountId: string;
  categoryId: string;
  type: TransactionType;
  label: string;
  /** Written the way the amount parser reads it back, so an edition changes no cent. */
  amount: string;
  /** `YYYY-MM-DD`, the only form a date input understands. */
  operationDate: string;
  notes: string;
};

/**
 * Maps a stored row to what the form can actually be given.
 *
 * The two conversions are the whole point: an exact decimal becomes a string the parser
 * accepts, and a calendar day becomes the date input's format. Everything the form does
 * not edit (account and category names, a currency, a source reference) is left out
 * rather than passed along and ignored.
 */
export function toTransactionFormInitialValues(
  record: TransactionRecord,
): TransactionFormInitialValues {
  return {
    id: record.id,
    accountId: record.accountId,
    categoryId: record.categoryId ?? "",
    type: record.type,
    label: record.label,
    amount: toDecimalString(record.amount),
    operationDate: toDateOnlyString(record.operationDate),
    notes: record.notes ?? "",
  };
}

/**
 * A transaction amount must stay consistent with its type: an income is
 * positive, an expense is negative. A refund is a positive amount carried by an
 * EXPENSE transaction, which the totals then treat as a reduction of expenses.
 */
export function assertAmountMatchesType(
  amount: Decimal,
  type: TransactionType,
): void {
  if (type === "INCOME" && amount.isNegative()) {
    throw new Error(
      "Une recette doit être positive. Utilisez une dépense négative ou un remboursement.",
    );
  }

  if (type === "EXPENSE" && amount.isZero()) {
    throw new Error("Une dépense de zéro n'apporte aucune information.");
  }
}

/**
 * Monthly budgets: a planned amount per category, month and currency.
 *
 * A budget is a positive magnitude: "300 € for groceries" reads the same whoever reads
 * it, and the category's kind says whether it is a spending envelope or an income
 * target. The sign conventions of transactions do not apply to it; reconciling the plan
 * with signed actuals is the reporting layer's job (BP-02).
 *
 * Currencies are never converted, so one category can carry one budget per currency for
 * the same month — and exactly one, which the unique constraint enforces.
 */

export type BudgetRecord = {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryKind: CategoryKind;
  year: number;
  /** 1-based month, as a human writes it. */
  month: number;
  currency: Currency;
  /** Planned amount, always positive. */
  amount: Decimal;
};

/** Identity of a budget row: what the uniqueness rule compares. */
export type BudgetIdentity = {
  categoryId: string;
  year: number;
  month: number;
  currency: Currency;
};

/** `YYYY-MM` key, the month form used across the project. */
export function budgetMonthKey(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** Full identity of a budget, serialised so two tuples can be compared without drift. */
export function budgetIdentityKey(budget: BudgetIdentity): string {
  return `${budget.categoryId}|${budgetMonthKey(budget.year, budget.month)}|${budget.currency}`;
}

/**
 * The first budget of `existing` that already covers this category, month and currency,
 * or `null` when the period is free.
 *
 * This is the rule; the unique index on the same tuple is what keeps it true under
 * concurrent writes. The Server Actions check it before writing so a duplicate is
 * refused as a field error, and still translate a unique-constraint violation into the
 * same message when two requests cross.
 */
export function findDuplicateBudget<T extends BudgetIdentity>(
  candidate: BudgetIdentity,
  existing: readonly T[],
): T | null {
  const key = budgetIdentityKey(candidate);

  return existing.find((row) => budgetIdentityKey(row) === key) ?? null;
}

/** Message shared by the pre-check and the constraint-violation path. */
export const DUPLICATE_BUDGET_MESSAGE =
  "Un budget existe déjà pour cette catégorie sur ce mois, dans cette devise.";

/**
 * A `YYYY-MM` month, validated against the project's calendar bounds (year 1970-9999,
 * month 1-12) and converted to the two integers the model stores.
 */
export const budgetMonthSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      // Destructured on purpose: `parseMonthKey` also carries the month's bounds, and
      // the schema contract is exactly the two integers the model stores.
      const { year, month } = parseMonthKey(value);
      return { year, month };
    } catch {
      ctx.addIssue({ code: "custom", message: "Mois attendu au format AAAA-MM." });
      return z.NEVER;
    }
  });

/**
 * A planned amount, strictly positive.
 *
 * The absence of a budget is the absence of a row: a zero plan would say nothing, and a
 * negative one would contradict the magnitude a budget is.
 */
const budgetAmount = amount.refine(
  (value) => value.greaterThan(0),
  "Le montant prévu doit être supérieur à zéro.",
);

/**
 * Input contract for a monthly budget, shared by the form and the Server Actions.
 *
 * The owner never travels in the payload: it comes from the session. The category is an
 * identifier the action resolves against the owner's own categories, so a foreign one is
 * "not found" rather than a leak.
 */
export const budgetInputSchema = z.object({
  categoryId: z.string().trim().min(1, "Une catégorie est requise."),
  month: budgetMonthSchema,
  currency: currencyCode,
  amount: budgetAmount,
});

export type BudgetInput = z.input<typeof budgetInputSchema>;
export type ValidatedBudgetInput = z.output<typeof budgetInputSchema>;

/** Creation fields plus the identifier of the row being replaced. */
export const budgetUpdateSchema = budgetInputSchema.extend({
  id: z.string().trim().min(1, "Identifiant manquant."),
});

export type BudgetUpdateValues = z.input<typeof budgetUpdateSchema>;
export type ValidatedBudgetUpdate = z.output<typeof budgetUpdateSchema>;

/**
 * A budget prepared for the edit form.
 *
 * Strings only, and deliberately so: a `Decimal` cannot cross the server/client boundary,
 * and a month input only understands `YYYY-MM`. The conversion happens on the server,
 * where the exact value lives.
 */
export type BudgetFormInitialValues = {
  id: string;
  categoryId: string;
  /** `YYYY-MM`. */
  month: string;
  currency: Currency;
  amount: string;
};

export function toBudgetFormInitialValues(record: BudgetRecord): BudgetFormInitialValues {
  return {
    id: record.id,
    categoryId: record.categoryId,
    month: budgetMonthKey(record.year, record.month),
    currency: record.currency,
    amount: toDecimalString(record.amount),
  };
}
