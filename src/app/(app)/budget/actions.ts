"use server";

import { revalidatePath } from "next/cache";
import {
  invalidResult,
  rejectedResult,
  unexpectedResult,
  type ActionResult,
} from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import { recordIdInput } from "@/lib/validation";
import {
  accountInputSchema,
  assertAmountMatchesType,
  categoryInputSchema,
  categoryMismatchReason,
  transactionFormSchema,
} from "@/modules/budget/domain";
import {
  createAccount,
  createCategory,
  createTransaction,
  deleteTransaction,
  findAccount,
  findCategory,
} from "@/modules/budget/repository";
import { findCashflowLinkedToTransaction } from "@/modules/real-estate/repository";

/**
 * Write Server Actions for the budget module.
 *
 * Authorisation is checked here, on the server, before anything else: a Server
 * Action is a public endpoint. The same zod schema that drives the form validates
 * the payload again, and every identifier it carries is looked up for the
 * signed-in owner, so a replayed request cannot reach another account.
 */

export async function createAccountAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = accountInputSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  try {
    await createAccount({
      userId: user.id,
      name: parsed.data.name,
      type: parsed.data.type,
      currency: parsed.data.currency,
    });
  } catch (error) {
    return unexpectedResult("createAccount", error);
  }

  revalidatePath("/budget");
  return { status: "ok" };
}

export async function createCategoryAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = categoryInputSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  try {
    await createCategory({
      userId: user.id,
      name: parsed.data.name,
      kind: parsed.data.kind,
    });
  } catch (error) {
    return unexpectedResult("createCategory", error);
  }

  revalidatePath("/budget");
  return { status: "ok" };
}

export async function createTransactionAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = transactionFormSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const input = parsed.data;

  // The account is owned by the user, and it is what determines the currency:
  // the form deliberately carries no currency field.
  const account = await findAccount(user.id, input.accountId);
  if (!account) {
    return rejectedResult("accountId", "Compte introuvable.");
  }

  // The form only offers categories of the matching kind, but a request body can be
  // replayed by hand: the rule is enforced here too, or an expense would sit on an
  // income category and be counted in the wrong place by every report.
  const category = input.categoryId ? await findCategory(user.id, input.categoryId) : null;

  if (input.categoryId && !category) {
    return rejectedResult("categoryId", "Catégorie introuvable.");
  }

  const categoryMismatch = categoryMismatchReason(input.type, category);
  if (categoryMismatch) {
    return rejectedResult("categoryId", categoryMismatch);
  }

  // Refuses an income written as a negative amount: the sign carries the meaning.
  try {
    assertAmountMatchesType(input.amount, input.type);
  } catch (error) {
    return rejectedResult(
      "amount",
      error instanceof Error ? error.message : "Montant incohérent avec le type.",
    );
  }

  try {
    await createTransaction({
      userId: user.id,
      accountId: account.id,
      categoryId: input.categoryId,
      type: input.type,
      label: input.label,
      amount: input.amount,
      currency: account.currency,
      operationDate: input.operationDate,
      notes: input.notes,
      // Imports set this to the source identifier of the record; a manual entry
      // has no source, so the uniqueness rule never blocks it.
      externalRef: null,
    });
  } catch (error) {
    return unexpectedResult("createTransaction", error);
  }

  revalidatePath("/budget");
  revalidatePath("/dashboard");
  return { status: "ok" };
}

/**
 * Removes one transaction.
 *
 * A deliberate refusal before a deliberate deletion: a transaction linked to a
 * property cashflow cannot be removed here. The schema would null the link, leaving
 * the cashflow with neither an amount nor a transaction, which is precisely the state
 * `resolveCashflowAmount` throws on — the property page would then fail for a row the
 * owner can no longer see. Naming the property is more useful than a crash later.
 */
export async function deleteTransactionAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = recordIdInput.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const link = await findCashflowLinkedToTransaction(user.id, parsed.data.id);
  if (link) {
    return rejectedResult(
      "id",
      `Cette opération est rattachée au flux du bien « ${link.propertyName} ». Supprimez d'abord ce flux dans Immobilier.`,
    );
  }

  try {
    const deleted = await deleteTransaction(user.id, parsed.data.id);
    if (!deleted) {
      return rejectedResult("id", "Opération introuvable : elle a peut-être déjà été supprimée.");
    }
  } catch (error) {
    return unexpectedResult("deleteTransaction", error);
  }

  revalidatePath("/budget");
  revalidatePath("/dashboard");
  return { status: "ok" };
}
