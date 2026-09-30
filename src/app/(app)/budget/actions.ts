"use server";

import { revalidatePath } from "next/cache";
import {
  invalidResult,
  rejectedResult,
  unexpectedResult,
  type ActionResult,
} from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import {
  accountInputSchema,
  assertAmountMatchesType,
  categoryInputSchema,
  transactionFormSchema,
} from "@/modules/budget/domain";
import {
  createAccount,
  createCategory,
  createTransaction,
  findAccount,
  findCategory,
} from "@/modules/budget/repository";

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

  if (input.categoryId && !(await findCategory(user.id, input.categoryId))) {
    return rejectedResult("categoryId", "Catégorie introuvable.");
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
