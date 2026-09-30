"use server";

import { revalidatePath } from "next/cache";
import {
  invalidResult,
  isUniqueConstraintError,
  rejectedResult,
  unexpectedResult,
  type ActionResult,
} from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import { DEFAULT_CURRENCY } from "@/lib/money";
import { cashflowInputSchema, propertyInputSchema } from "@/modules/real-estate/domain";
import { createCashflow, createProperty, findProperty } from "@/modules/real-estate/repository";
import { findTransactionRef } from "@/modules/budget/repository";

/**
 * Write Server Actions for the real-estate module.
 *
 * Same contract as the budget actions: authorisation first, validation with the
 * module schema, every identifier looked up for the signed-in owner.
 */

export async function createPropertyAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = propertyInputSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  try {
    await createProperty({
      userId: user.id,
      name: parsed.data.name,
      address: parsed.data.address,
      occupancy: parsed.data.occupancy,
      purchaseDate: parsed.data.purchaseDate,
      saleDate: parsed.data.saleDate,
      notes: parsed.data.notes,
    });
  } catch (error) {
    return unexpectedResult("createProperty", error);
  }

  revalidatePath("/real-estate");
  revalidatePath("/dashboard");
  return { status: "ok" };
}

export async function createCashflowAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = cashflowInputSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const input = parsed.data;

  const property = await findProperty(user.id, input.propertyId);
  if (!property) {
    return rejectedResult("propertyId", "Bien introuvable.");
  }

  // Exactly one of these is set: `cashflowInputSchema` enforces the exclusivity
  // that keeps a linked transaction from being counted twice.
  let currency = input.currency ?? DEFAULT_CURRENCY;

  if (input.transactionId) {
    const transaction = await findTransactionRef(user.id, input.transactionId);
    if (!transaction) {
      return rejectedResult("transactionId", "Transaction introuvable.");
    }

    // The linked transaction is the single source of truth, currency included:
    // a different one would make the property total mix two currencies.
    currency = transaction.currency;
  }

  try {
    await createCashflow({
      propertyId: property.id,
      kind: input.kind,
      label: input.label,
      amount: input.amount,
      transactionId: input.transactionId,
      currency,
      dueDate: input.dueDate,
      settledAt: input.settledAt,
      notes: input.notes,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return rejectedResult(
        "transactionId",
        "Cette transaction est déjà rattachée à un flux.",
      );
    }

    return unexpectedResult("createCashflow", error);
  }

  revalidatePath("/real-estate");
  revalidatePath("/dashboard");
  return { status: "ok" };
}
