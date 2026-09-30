import Decimal from "decimal.js";
import { z } from "zod";
import type { Currency } from "@/lib/money";
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
