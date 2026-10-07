"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { FormFeedback, SubmitButton, useRecordedAction } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, type Currency } from "@/lib/money";
import {
  budgetInputSchema,
  type BudgetFormInitialValues,
  type BudgetInput,
  type CategoryKind,
  type CategorySummary,
} from "@/modules/budget/domain";
import { createBudgetAction, updateBudgetAction } from "./actions";

const KIND_LABELS: Record<CategoryKind, string> = {
  INCOME: "Recette",
  EXPENSE: "Dépense",
};

/**
 * Types a monthly budget, or corrects one.
 *
 * One component for both, like the transaction form: an edition is the same fields with
 * values already in them. The category list is not filtered by kind — a budget may cover
 * a spending category as well as an income one, and the kind is read from the category
 * rather than asked for a second time.
 *
 * The currency is asked for because a budget is not attached to an account: the same
 * category may carry one budget per currency, and no conversion ever happens between
 * them.
 */
export function BudgetForm({
  categories,
  defaultMonth,
  defaultCategoryId,
  defaultCurrency,
  defaultAmount,
  averageHint,
  editing = null,
  cancelHref,
}: {
  categories: CategorySummary[];
  /** `YYYY-MM` of the month currently displayed by the page. */
  defaultMonth: string;
  /** Pre-selected category, when the form is opened from a suggestion. */
  defaultCategoryId?: string;
  /** Pre-selected currency, when the form is opened from a suggestion. */
  defaultCurrency?: Currency;
  /** Pre-filled amount — the suggested monthly average, never a stored value. */
  defaultAmount?: string;
  /** Explains where a pre-filled amount comes from, when it does. */
  averageHint?: string;
  /**
   * The row being corrected, already reduced to plain strings by the server: a `Decimal`
   * cannot cross into this component at all.
   */
  editing?: BudgetFormInitialValues | null;
  /** Where "Annuler" returns to, month preserved. Used while editing. */
  cancelHref?: string;
}) {
  const isEditing = editing !== null;

  const form = useForm<BudgetInput>({
    resolver: zodResolver(budgetInputSchema, undefined, { raw: true }),
    defaultValues: {
      categoryId: editing?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? "",
      month: editing?.month ?? defaultMonth,
      currency: editing?.currency ?? defaultCurrency ?? DEFAULT_CURRENCY,
      amount: editing?.amount ?? defaultAmount ?? "",
    },
  });

  // The identifier is added here rather than kept in a hidden field: the values stay the
  // creation contract, and only the action they are sent to distinguishes the cases.
  const { result, submit } = useRecordedAction(form, (values) =>
    editing ? updateBudgetAction({ ...values, id: editing.id }) : createBudgetAction(values),
  );
  const { errors, isSubmitting } = form.formState;

  // The category list grows while this form is mounted (the category form sits above):
  // adopt the first category without ever overriding a chosen one.
  useEffect(() => {
    if (!form.getValues("categoryId") && categories[0]) {
      form.setValue("categoryId", categories[0].id);
    }
  }, [categories, form]);

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" noValidate>
      <Field
        label="Catégorie"
        htmlFor="budget-category"
        error={errors.categoryId?.message}
        hint="Recette ou dépense : la nature du budget suit celle de la catégorie."
      >
        <select id="budget-category" className={inputClass} {...form.register("categoryId")}>
          {categories.length === 0 ? <option value="">Aucune catégorie</option> : null}
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name} — {KIND_LABELS[category.kind]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Mois" htmlFor="budget-month" error={errors.month?.message}>
        <input
          id="budget-month"
          type="month"
          className={inputClass}
          {...form.register("month")}
        />
      </Field>

      <Field
        label="Devise"
        htmlFor="budget-currency"
        error={errors.currency?.message}
        hint="Aucune conversion : chaque devise garde son propre budget."
      >
        <select id="budget-currency" className={inputClass} {...form.register("currency")}>
          {SUPPORTED_CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Montant prévu"
        htmlFor="budget-amount"
        error={errors.amount?.message}
        hint={
          averageHint ??
          "Positif : « 300 » pour un budget de 300 €."
        }
      >
        <input
          id="budget-amount"
          className={inputClass}
          inputMode="decimal"
          autoComplete="off"
          placeholder="300,00"
          {...form.register("amount")}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
        <SubmitButton
          label={isEditing ? "Enregistrer les modifications" : "Ajouter le budget"}
          pending={isSubmitting}
        />
        {isEditing && cancelHref ? (
          <Link
            href={cancelHref}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Annuler
          </Link>
        ) : null}
      </div>

      <div className="sm:col-span-2 lg:col-span-4">
        <FormFeedback
          result={result}
          successMessage={isEditing ? "Budget modifié." : "Budget enregistré."}
        />
      </div>
    </form>
  );
}
