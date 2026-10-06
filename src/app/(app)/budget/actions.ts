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
import { formatMonthLabel, monthRange } from "@/lib/dates";
import { recordIdInput } from "@/lib/validation";
import {
  accountInputSchema,
  budgetInputSchema,
  budgetUpdateSchema,
  categoryInputSchema,
  DUPLICATE_BUDGET_MESSAGE,
  transactionFormSchema,
  transactionUpdateSchema,
  type CategorySummary,
  type ValidatedBudgetInput,
} from "@/modules/budget/domain";
import {
  createAccount,
  createBudget,
  createCategory,
  createTransaction,
  createWorkDay,
  deleteBudget,
  deleteTransaction,
  deleteWorkDay,
  ensureCategory,
  findAccount,
  findBudgetByPeriod,
  findCategory,
  findSalarySetting,
  findTransactionByExternalRef,
  findWorkDay,
  listWorkDays,
  updateBudget,
  updateTransaction,
  updateWorkDay,
  upsertSalarySetting,
} from "@/modules/budget/repository";
import {
  adjustWorkDayHours,
  computeSalarySummary,
  DUPLICATE_SALARY_BOOKING_MESSAGE,
  nextWorkDayState,
  SALARY_CATEGORY_NAME,
  salaryBookingInputSchema,
  salaryBookingRef,
  salarySettingInputSchema,
  workDayHoursInputSchema,
  workDayInputSchema,
} from "@/modules/budget/salary";
import { resolveTransactionInput } from "@/modules/budget/transactions";
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

/**
 * Validation shared by the creation and the edition of a budget.
 *
 * Two things must hold before anything is written: the category belongs to the owner,
 * and the (category, month, currency) period is still free. `excludeBudgetId` keeps an
 * edition's own row out of the duplicate check, so correcting only the amount is not a
 * collision with itself.
 *
 * The pre-check is not a race guard: two requests can cross between the read and the
 * write, and the unique index is what refuses the second one. It is there so the
 * ordinary duplicate arrives as a readable field error without a database exception.
 */
async function resolveBudgetInput(
  userId: string,
  input: ValidatedBudgetInput,
  options: { excludeBudgetId?: string } = {},
): Promise<{ ok: true; category: CategorySummary } | { ok: false; result: ActionResult }> {
  const category = await findCategory(userId, input.categoryId);
  if (!category) {
    return { ok: false, result: rejectedResult("categoryId", "Catégorie introuvable.") };
  }

  const duplicate = await findBudgetByPeriod(userId, {
    categoryId: category.id,
    year: input.month.year,
    month: input.month.month,
    currency: input.currency,
  });

  if (duplicate && duplicate.id !== options.excludeBudgetId) {
    return { ok: false, result: rejectedResult("categoryId", DUPLICATE_BUDGET_MESSAGE) };
  }

  return { ok: true, category };
}

export async function createBudgetAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = budgetInputSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const input = parsed.data;

  const resolved = await resolveBudgetInput(user.id, input);
  if (!resolved.ok) {
    return resolved.result;
  }

  try {
    await createBudget({
      userId: user.id,
      categoryId: resolved.category.id,
      year: input.month.year,
      month: input.month.month,
      currency: input.currency,
      amount: input.amount,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return rejectedResult("categoryId", DUPLICATE_BUDGET_MESSAGE);
    }

    return unexpectedResult("createBudget", error);
  }

  revalidatePath("/budget");
  return { status: "ok" };
}

/** Edits one monthly budget in place; same rules as the creation. */
export async function updateBudgetAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = budgetUpdateSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const input = parsed.data;

  const resolved = await resolveBudgetInput(user.id, input, { excludeBudgetId: input.id });
  if (!resolved.ok) {
    return resolved.result;
  }

  try {
    const updated = await updateBudget(user.id, input.id, {
      categoryId: resolved.category.id,
      year: input.month.year,
      month: input.month.month,
      currency: input.currency,
      amount: input.amount,
    });

    if (!updated) {
      return rejectedResult(
        "id",
        "Budget introuvable : il a peut-être été supprimé entre-temps.",
      );
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return rejectedResult("categoryId", DUPLICATE_BUDGET_MESSAGE);
    }

    return unexpectedResult("updateBudget", error);
  }

  revalidatePath("/budget");
  return { status: "ok" };
}

/** Removes one monthly budget. The two-step confirmation lives in the client component. */
export async function deleteBudgetAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = recordIdInput.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  try {
    const deleted = await deleteBudget(user.id, parsed.data.id);
    if (!deleted) {
      return rejectedResult("id", "Budget introuvable : il a peut-être déjà été supprimé.");
    }
  } catch (error) {
    return unexpectedResult("deleteBudget", error);
  }

  revalidatePath("/budget");
  return { status: "ok" };
}

/**
 * Saves the owner's hourly rate and default day length.
 *
 * One setting per owner: the form creates it on first use and replaces it afterwards.
 * Only the rate is stored — the weekly and monthly figures shown next to it are derived
 * at render time (see `salaryEquivalents`).
 */
export async function saveSalarySettingAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = salarySettingInputSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  try {
    await upsertSalarySetting({
      userId: user.id,
      hourlyRate: parsed.data.hourlyRate,
      hoursPerDay: parsed.data.hoursPerDay,
      currency: parsed.data.currency,
    });
  } catch (error) {
    return unexpectedResult("saveSalarySetting", error);
  }

  revalidatePath("/budget");
  return { status: "ok" };
}

/**
 * One click on the salary calendar.
 *
 * The cycle is the feature: the first click plans the day with the configured day
 * length, the second marks it really worked, the third removes it. The current state is
 * read here rather than accepted from the browser, so a replayed payload cannot skip a
 * level; the unique constraint on (owner, date) keeps a crossed request from creating
 * two rows.
 */
export async function cycleWorkDayAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = workDayInputSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const date = parsed.data.date;

  try {
    const [setting, current] = await Promise.all([
      findSalarySetting(user.id),
      findWorkDay(user.id, date),
    ]);

    if (!setting) {
      return rejectedResult(
        "date",
        "Renseignez d'abord votre taux horaire : il transforme les heures cliquées en montants.",
      );
    }

    const next = nextWorkDayState(current?.status ?? null);

    if (next === "REMOVE") {
      await deleteWorkDay(user.id, date);
    } else if (current === null) {
      await createWorkDay({
        userId: user.id,
        date,
        status: next,
        // The configured day length is copied onto the day: editing the setting later
        // must not rewrite days that were already planned.
        hours: setting.hoursPerDay,
      });
    } else {
      await updateWorkDay(user.id, date, { status: next });
    }
  } catch (error) {
    return unexpectedResult("cycleWorkDay", error);
  }

  revalidatePath("/budget");
  return { status: "ok" };
}

/** Half-hour adjustment of one planned or worked day. */
export async function adjustWorkDayHoursAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = workDayHoursInputSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const { date, direction } = parsed.data;

  try {
    const current = await findWorkDay(user.id, date);
    if (!current) {
      return rejectedResult("date", "Ce jour n'est plus dans le calendrier : rechargez la page.");
    }

    const nextHours = adjustWorkDayHours(current.hours, direction);
    // At a bound the value does not move: no write, but still a success, so a button
    // that has nothing left to do never looks like an error.
    if (!nextHours.equals(current.hours)) {
      await updateWorkDay(user.id, date, { hours: nextHours });
    }
  } catch (error) {
    return unexpectedResult("adjustWorkDayHours", error);
  }

  revalidatePath("/budget");
  return { status: "ok" };
}

/**
 * Turns the month's simulated hours into one real income entry.
 *
 * The booking is the only way the simulation writes into the accounts, and it does so on
 * the owner's explicit click: the amount is recomputed here from the month's clicked days
 * — planned and worked, each counted once (never taken from the browser) — the account
 * must be in the salary currency (no conversion), and the « Salaire » category is created
 * if the owner never made one. The Prévisions tab shows the same prévision and calls this
 * same action, so both doors record the same figure. The entry carries a stable import
 * reference (`salary:2026-10`), so the unique constraint makes a second attempt for the
 * same month fail instead of silently doubling the income; the pre-check lets the tabs
 * show the recorded entry instead of the button.
 */
export async function bookSalaryAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = salaryBookingInputSchema.safeParse(values);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const { month, accountId, date } = parsed.data;

  try {
    const [setting, account] = await Promise.all([
      findSalarySetting(user.id),
      findAccount(user.id, accountId),
    ]);

    if (!setting) {
      return rejectedResult(
        "accountId",
        "Renseignez d'abord votre taux horaire : il transforme les heures en montants.",
      );
    }

    if (!account) {
      return rejectedResult("accountId", "Compte introuvable.");
    }

    if (account.currency !== setting.currency) {
      return rejectedResult(
        "accountId",
        `Le salaire est en ${setting.currency} : choisissez un compte dans cette devise, aucune conversion n'est faite.`,
      );
    }

    const reference = salaryBookingRef(month.year, month.month);
    const existing = await findTransactionByExternalRef(user.id, reference);
    if (existing) {
      return rejectedResult("accountId", DUPLICATE_SALARY_BOOKING_MESSAGE);
    }

    const range = monthRange(month.year, month.month);
    const workDays = await listWorkDays(user.id, { from: range.start, to: range.end });
    const summary = computeSalarySummary(workDays, setting.hourlyRate);

    if (summary.totalAmount.isZero()) {
      return rejectedResult(
        "date",
        "Aucun jour cliqué sur ce mois : il n'y a rien à enregistrer.",
      );
    }

    const category = await ensureCategory({
      userId: user.id,
      name: SALARY_CATEGORY_NAME,
      kind: "INCOME",
    });

    await createTransaction({
      userId: user.id,
      accountId: account.id,
      categoryId: category.id,
      type: "INCOME",
      // Simulated hours × rate (planned + worked, each day once), positive: the sign
      // rule for an income holds.
      label: `Salaire ${formatMonthLabel(month.year, month.month)}`,
      amount: summary.totalAmount,
      currency: account.currency,
      operationDate: date,
      notes: null,
      externalRef: reference,
    });
  } catch (error) {
    // The unique index is the race guard for two clicks crossing between the pre-check
    // and the write; it answers with the same message as the pre-check.
    if (isUniqueConstraintError(error)) {
      return rejectedResult("accountId", DUPLICATE_SALARY_BOOKING_MESSAGE);
    }

    return unexpectedResult("bookSalary", error);
  }

  revalidatePath("/budget");
  revalidatePath("/dashboard");
  return { status: "ok" };
}
