"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { FormFeedback, SubmitButton, useRecordedAction } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import type { AccountSummary, CategorySummary } from "@/modules/budget/domain";
import {
  recurringEntryInputSchema,
  type ForecastType,
  type RecurringEntryInput,
} from "@/modules/budget/recurrence";
import { createRecurringEntryAction } from "./forecast-actions";

const TYPE_LABELS: Record<ForecastType, string> = {
  INCOME: "Recette attendue",
  EXPENSE: "Dépense attendue",
};

/**
 * Creates a recurring series.
 *
 * The amount is asked positive, like a budget: it describes what is expected, and the
 * nature gives the direction — the sign only appears on the day an occurrence is
 * confirmed into the ledger. The category list follows the nature, and the currency is
 * never asked: an occurrence takes the currency of its account at confirmation time.
 */
export function RecurringEntryForm({
  accounts,
  categories,
  defaultStartDate,
}: {
  accounts: AccountSummary[];
  categories: CategorySummary[];
  /** `YYYY-MM-DD`: first day of the month displayed by the page. */
  defaultStartDate: string;
}) {
  const form = useForm<RecurringEntryInput>({
    resolver: zodResolver(recurringEntryInputSchema, undefined, { raw: true }),
    defaultValues: {
      label: "",
      type: "EXPENSE",
      amount: "",
      accountId: accounts[0]?.id ?? "",
      categoryId: "",
      frequency: "MONTHLY",
      startDate: defaultStartDate,
      endDate: "",
    },
  });

  const { result, submit } = useRecordedAction(form, createRecurringEntryAction);
  const { errors, isSubmitting } = form.formState;

  const type = useWatch({ control: form.control, name: "type" });
  const categoryOptions = categories.filter((category) => category.kind === type);

  // The category list follows the chosen nature — an expense uses an expense category,
  // exactly like a manual entry. Adopt the first offered one, without ever overriding a
  // choice that remains valid.
  useEffect(() => {
    const options = categories.filter((category) => category.kind === type);
    const current = form.getValues("categoryId");
    if (!options.some((category) => category.id === current)) {
      form.setValue("categoryId", options[0]?.id ?? "");
    }
  }, [type, categories, form]);

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" noValidate>
      <Field label="Libellé" htmlFor="recurring-label" error={errors.label?.message}>
        <input
          id="recurring-label"
          className={inputClass}
          autoComplete="off"
          placeholder="Loyer, abonnement, salaire…"
          {...form.register("label")}
        />
      </Field>

      <Field
        label="Nature"
        htmlFor="recurring-type"
        error={errors.type?.message}
        hint="Le sens du mouvement : une recette attendue, ou une dépense attendue."
      >
        <select id="recurring-type" className={inputClass} {...form.register("type")}>
          {(Object.keys(TYPE_LABELS) as ForecastType[]).map((value) => (
            <option key={value} value={value}>
              {TYPE_LABELS[value]}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Montant prévu"
        htmlFor="recurring-amount"
        error={errors.amount?.message}
        hint="Positif : « 950 » pour un loyer de 950 €, le sens vient de la nature."
      >
        <input
          id="recurring-amount"
          className={inputClass}
          inputMode="decimal"
          autoComplete="off"
          placeholder="950,00"
          {...form.register("amount")}
        />
      </Field>

      <Field
        label="Fréquence"
        htmlFor="recurring-frequency"
        error={errors.frequency?.message}
        hint="Une échéance par mois, au jour de la date de début."
      >
        <select id="recurring-frequency" className={inputClass} {...form.register("frequency")}>
          <option value="MONTHLY">Mensuelle</option>
        </select>
      </Field>

      <Field label="Compte" htmlFor="recurring-account" error={errors.accountId?.message}>
        <select id="recurring-account" className={inputClass} {...form.register("accountId")}>
          {accounts.length === 0 ? <option value="">Aucun compte</option> : null}
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} ({account.currency})
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Catégorie"
        htmlFor="recurring-category"
        error={errors.categoryId?.message}
        hint="Facultative, mais de la même nature que la série."
      >
        <select id="recurring-category" className={inputClass} {...form.register("categoryId")}>
          {categoryOptions.length === 0 ? <option value="">Aucune catégorie</option> : null}
          {categoryOptions.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Début"
        htmlFor="recurring-start"
        error={errors.startDate?.message}
        hint="La série se répète chaque mois à ce jour-là ; sur un mois plus court, elle tombe le dernier jour (31 janvier → 28 février)."
      >
        <input
          id="recurring-start"
          type="date"
          className={inputClass}
          {...form.register("startDate")}
        />
      </Field>

      <Field
        label="Fin (facultative)"
        htmlFor="recurring-end"
        error={errors.endDate?.message}
        hint="Incluse. Vide : la série ne s'arrête pas."
      >
        <input
          id="recurring-end"
          type="date"
          className={inputClass}
          {...form.register("endDate")}
        />
      </Field>

      <div className="sm:col-span-2 lg:col-span-4">
        <SubmitButton label="Ajouter la série" pending={isSubmitting} />
      </div>

      <div className="sm:col-span-2 lg:col-span-4">
        <FormFeedback result={result} successMessage="Série enregistrée." />
      </div>
    </form>
  );
}
