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
  transactionUpdateSchema,
  type AccountSummary,
  type CategorySummary,
  type ValidatedTransactionForm,
} from "@/modules/budget/domain";
import {
  createAccount,
  createCategory,
  createTransaction,
  deleteTransaction,
  findAccount,
  findCategory,
  updateTransaction,
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

/**
 * Validation shared by the creation and the edition of a transaction.
 *
 * The two write the same fields under the same rules, and letting them drift apart is
 * how an edition ends up accepting what a creation refuses. The owner identifier comes
 * from the session in both cases, never from the payload, so a replayed identifier
 * cannot point at somebody else's account.
 */
async function resolveTransactionInput(
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

export async function createTransactionAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = transactionFormSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const input = parsed.data;

  const resolved = await resolveTransactionInput(user.id, input);
  if (!resolved.ok) {
    return resolved.result;
  }

  try {
    await createTransaction({
      userId: user.id,
      accountId: resolved.account.id,
      categoryId: input.categoryId,
      type: input.type,
      label: input.label,
      amount: input.amount,
      currency: resolved.account.currency,
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
 * Edits one transaction in place.
 *
 * Same rules as the creation, plus one of its own: the row must still exist and belong
 * to the signed-in owner. Correcting a line matters more than it looks — deleting it and
 * typing it again would drop the link a property cashflow holds on it, and move the date
 * of a correction nobody asked to recreate.
 */
export async function updateTransactionAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = transactionUpdateSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const input = parsed.data;

  const resolved = await resolveTransactionInput(user.id, input);
  if (!resolved.ok) {
    return resolved.result;
  }

  try {
    const updated = await updateTransaction(user.id, input.id, {
      accountId: resolved.account.id,
      categoryId: input.categoryId,
      type: input.type,
      label: input.label,
      amount: input.amount,
      currency: resolved.account.currency,
      operationDate: input.operationDate,
      notes: input.notes,
    });

    if (!updated) {
      return rejectedResult(
        "id",
        "Opération introuvable : elle a peut-être été supprimée entre-temps.",
      );
    }
  } catch (error) {
    return unexpectedResult("updateTransaction", error);
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
