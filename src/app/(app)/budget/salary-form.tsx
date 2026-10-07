"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { FormFeedback, SubmitButton, useRecordedAction } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, type Currency } from "@/lib/money";
import {
  salarySettingInputSchema,
  type SalarySettingInput,
} from "@/modules/budget/salary";
import { saveSalarySettingAction } from "./actions";

/**
 * The wage of the owner: an hourly rate and the default length of a plannable day.
 *
 * One setting per owner, so the form is an upsert and doubles as the "create" and
 * "edit" view. Only the rate is stored; the weekly and monthly figures shown next to it
 * on the salary card are derived at render time.
 *
 * A successful submission keeps the typed values (the fresh save is the new reference),
 * so the form never falls back to the values it was mounted with.
 */
export function SalaryForm({
  editing = null,
}: {
  /** The saved setting, already reduced to strings by the server. */
  editing?: { hourlyRate: string; hoursPerDay: string; currency: Currency } | null;
}) {
  const form = useForm<SalarySettingInput>({
    resolver: zodResolver(salarySettingInputSchema, undefined, { raw: true }),
    defaultValues: {
      hourlyRate: editing?.hourlyRate ?? "",
      hoursPerDay: editing?.hoursPerDay ?? "7",
      currency: editing?.currency ?? DEFAULT_CURRENCY,
    },
  });

  const { result, submit } = useRecordedAction(form, saveSalarySettingAction, {
    keepValues: true,
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3" noValidate>
      <Field
        label="Taux horaire"
        htmlFor="salary-hourly-rate"
        error={errors.hourlyRate?.message}
        hint="Toujours ramené à une heure : tout le simulateur dérive de ce taux."
      >
        <input
          id="salary-hourly-rate"
          className={inputClass}
          inputMode="decimal"
          autoComplete="off"
          placeholder="20,50"
          {...form.register("hourlyRate")}
        />
      </Field>

      <Field
        label="Heures par jour"
        htmlFor="salary-hours-per-day"
        error={errors.hoursPerDay?.message}
        hint="Longueur d'un jour cliqué (0 à 24 h). Les jours déjà cliqués gardent leurs heures."
      >
        <input
          id="salary-hours-per-day"
          className={inputClass}
          inputMode="decimal"
          autoComplete="off"
          placeholder="7,5"
          {...form.register("hoursPerDay")}
        />
      </Field>

      <Field label="Devise" htmlFor="salary-currency" error={errors.currency?.message}>
        <select id="salary-currency" className={inputClass} {...form.register("currency")}>
          {SUPPORTED_CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </Field>

      <div className="sm:col-span-3">
        <SubmitButton label="Enregistrer le taux horaire" pending={isSubmitting} />
      </div>

      <div className="sm:col-span-3">
        <FormFeedback result={result} successMessage="Taux horaire enregistré." />
      </div>
    </form>
  );
}
