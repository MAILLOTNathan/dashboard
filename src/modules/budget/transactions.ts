import { rejectedResult, type ActionResult } from "@/lib/actions";
import {
  assertAmountMatchesType,
  categoryMismatchReason,
  type AccountSummary,
  type CategorySummary,
  type ValidatedTransactionForm,
} from "./domain";
import { findAccount, findCategory } from "./repository";

/**
 * Validation shared by every path that writes a transaction.
 *
 * The manual creation and the edition call it, and so does the confirmation of a
 * forecast occurrence (BP-03): a confirmed forecast cannot bypass the ownership and
 * kind rules a typed entry obeys. It lives outside the `"use server"` action files on
 * purpose — importing it from another action file cannot turn it into a callable
 * endpoint, because only a session may supply the owner identifier it takes.
 */
export async function resolveTransactionInput(
  userId: string,
  input: ValidatedTransactionForm,
): Promise<{ ok: true; account: AccountSummary } | { ok: false; result: ActionResult }> {
  // The account is owned by the user, and it is what determines the currency:
  // the form deliberately carries no currency field.
  const account = await findAccount(userId, input.accountId);
  if (!account) {
    return { ok: false, result: rejectedResult("accountId", "Compte introuvable.") };
  }

  // The form only offers categories of the matching kind, but a request body can be
  // replayed by hand: the rule is enforced here too, or an expense would sit on an
  // income category and be counted in the wrong place by every report.
  const category: CategorySummary | null = input.categoryId
    ? await findCategory(userId, input.categoryId)
    : null;

  if (input.categoryId && !category) {
    return { ok: false, result: rejectedResult("categoryId", "Catégorie introuvable.") };
  }

  const categoryMismatch = categoryMismatchReason(input.type, category);
  if (categoryMismatch) {
    return { ok: false, result: rejectedResult("categoryId", categoryMismatch) };
  }

  // Refuses an income written as a negative amount: the sign carries the meaning.
  try {
    assertAmountMatchesType(input.amount, input.type);
  } catch (error) {
    return {
      ok: false,
      result: rejectedResult(
        "amount",
        error instanceof Error ? error.message : "Montant incohérent avec le type.",
      ),
    };
  }

  return { ok: true, account };
}
