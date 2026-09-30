import Decimal from "decimal.js";
import { z } from "zod";
import { parseAmountInput, type Currency, assertCurrency } from "@/lib/money";

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
 * Input contract for a transaction, validated before it reaches the database.
 * Shared by the server actions and the spreadsheet view.
 */
export const transactionInputSchema = z.object({
  accountId: z.string().min(1, "Un compte est requis."),
  categoryId: z.string().min(1).nullable().default(null),
  type: z.enum(TRANSACTION_TYPES),
  label: z.string().trim().min(1, "Le libellé est requis.").max(200),
  amount: z
    .string()
    .min(1, "Le montant est requis.")
    .transform((value, ctx) => {
      try {
        return parseAmountInput(value);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message: error instanceof Error ? error.message : "Montant invalide.",
        });
        return z.NEVER;
      }
    }),
  currency: z.string().trim().length(3).transform(assertCurrency),
  // A date-only string: `YYYY-MM-DD`, with no time zone attached.
  operationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ."),
  notes: z.string().trim().max(2000).nullable().default(null),
});

export type TransactionInput = z.input<typeof transactionInputSchema>;
export type ValidatedTransactionInput = z.output<typeof transactionInputSchema>;

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
