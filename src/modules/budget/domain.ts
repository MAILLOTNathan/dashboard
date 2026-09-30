import Decimal from "decimal.js";
import { z } from "zod";
import { toDateOnlyString } from "@/lib/dates";
import { toDecimalString, type Currency } from "@/lib/money";
import {
  amount,
  currencyCode,
  optionalId,
  optionalText,
  requiredDate,
} from "@/lib/validation";

/**
 * Budget module: accounts, categories and transactions.
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
