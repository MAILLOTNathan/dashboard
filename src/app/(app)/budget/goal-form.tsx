"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { FormFeedback, SubmitButton, useRecordedAction } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, type Currency } from "@/lib/money";
import {
  GOAL_STATUSES,
  GOAL_STATUS_LABELS,
  goalInputSchema,
  type GoalFormInitialValues,
  type GoalInput,
} from "@/modules/budget/goals";
import { createGoalAction, updateGoalAction } from "./goal-actions";

/**
 * Types a goal, or corrects one.
 *
 * One component for both, like the other forms of the page. The current amount comes
 * from exactly one source: a manual amount, or the recorded balance of a linked account.
 * Leaving both empty is allowed — the table then shows "progression inconnue", which is
 * honest, rather than a zero the app cannot vouch for.
 */
export function GoalForm({
  accounts,
  editing = null,
  cancelHref,
}: {
  /** The owner's accounts, currency shown so a mismatch is visible before submitting. */
  accounts: { id: string; name: string; currency: Currency }[];
  /**
   * The goal being corrected, already reduced to plain strings by the server: a `Decimal`
   * cannot cross into this component at all.
   */
  editing?: GoalFormInitialValues | null;
  /** Where "Annuler" returns to. Used while editing. */
  cancelHref?: string;
}) {
  const isEditing = editing !== null;

  const form = useForm<GoalInput>({
    resolver: zodResolver(goalInputSchema, undefined, { raw: true }),
    defaultValues: {
      name: editing?.name ?? "",
      targetAmount: editing?.targetAmount ?? "",
      currency: editing?.currency ?? DEFAULT_CURRENCY,
      targetDate: editing?.targetDate ?? "",
      status: editing?.status ?? "ACTIVE",
      currentAmount: editing?.currentAmount ?? "",
      accountId: editing?.accountId ?? "",
    },
  });

  // The identifier is added here rather than kept in a hidden field: the values stay the
  // creation contract, and only the action they are sent to distinguishes the cases.
  const { result, submit } = useRecordedAction(form, (values) =>
    editing ? updateGoalAction({ ...values, id: editing.id }) : createGoalAction(values),
  );
  const { errors, isSubmitting } = form.formState;

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" noValidate>
      <Field
        label="Nom de l'objectif"
        htmlFor="goal-name"
        error={errors.name?.message}
        hint="Par exemple « Apport immobilier » ou « Remboursement prêt auto »."
      >
        <input
          id="goal-name"
          className={inputClass}
          autoComplete="off"
          maxLength={120}
          {...form.register("name")}
        />
      </Field>

      <Field
        label="Montant cible"
        htmlFor="goal-target-amount"
        error={errors.targetAmount?.message}
        hint="Positif, dans la devise choisie : « 10 000 » pour 10 000 €."
      >
        <input
          id="goal-target-amount"
          className={inputClass}
          inputMode="decimal"
          autoComplete="off"
          placeholder="10 000,00"
          {...form.register("targetAmount")}
        />
      </Field>

      <Field
        label="Devise"
        htmlFor="goal-currency"
        error={errors.currency?.message}
        hint="Aucune conversion : un compte lié doit être dans cette devise."
      >
        <select id="goal-currency" className={inputClass} {...form.register("currency")}>
          {SUPPORTED_CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Échéance"
        htmlFor="goal-target-date"
        error={errors.targetDate?.message}
        hint="Le jour visé pour atteindre le montant cible."
      >
        <input
          id="goal-target-date"
          type="date"
          className={inputClass}
          {...form.register("targetDate")}
        />
      </Field>

      <Field label="Statut" htmlFor="goal-status" error={errors.status?.message}>
        <select id="goal-status" className={inputClass} {...form.register("status")}>
          {GOAL_STATUSES.map((status) => (
            <option key={status} value={status}>
              {GOAL_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Montant actuel (saisi)"
        htmlFor="goal-current-amount"
        error={errors.currentAmount?.message}
        hint="Ce qui est déjà réuni, saisi à la main. À laisser vide si un compte lié fait foi."
      >
        <input
          id="goal-current-amount"
          className={inputClass}
          inputMode="decimal"
          autoComplete="off"
          placeholder="2 500,00"
          {...form.register("currentAmount")}
        />
      </Field>

      <Field
        label="Compte lié"
        htmlFor="goal-account"
        error={errors.accountId?.message}
        hint="La progression lira le solde enregistré du compte. Le montant saisi et le compte lié s'excluent."
      >
        <select id="goal-account" className={inputClass} {...form.register("accountId")}>
          <option value="">Aucun compte lié</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} — {account.currency}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
        <SubmitButton
          label={isEditing ? "Enregistrer les modifications" : "Ajouter l'objectif"}
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

      <div className="sm:col-span-2 lg:col-span-3">
        <FormFeedback
          result={result}
          successMessage={isEditing ? "Objectif modifié." : "Objectif enregistré."}
        />
      </div>
    </form>
  );
}
