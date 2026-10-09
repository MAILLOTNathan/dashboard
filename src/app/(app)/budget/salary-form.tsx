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
 * The simulator's settings: the hourly rate **of one month** plus the two global options.
 *
 * The rate is a change point — it applies from the submitted month on, until the next
 * entry — so the form both creates and edits it (the repository upserts on the month).
 * The day length and the currency are common to every month. Only the rate is stored;
 * the weekly and monthly figures shown next to it on the salary card are derived at
 * render time.
 *
 * A successful submission keeps the typed values (the fresh save is the new reference),
 * so the form never falls back to the values it was mounted with.
 */
export function SalaryForm({
  monthKey,
  monthLabel,
  editing = null,
}: {
  /** `YYYY-MM` of the month the rate is saved for. */
  monthKey: string;
  /** Its label (“octobre 2026”), read once on the server. */
  monthLabel: string;
  /** The values in force for that month, reduced to strings by the server. */
  editing?: { hourlyRate: string; hoursPerDay: string; currency: Currency } | null;
}) {
  const form = useForm<SalarySettingInput>({
    resolver: zodResolver(salarySettingInputSchema, undefined, { raw: true }),
    defaultValues: {
      month: monthKey,
      hourlyRate: editing?.hourlyRate ?? "",
      hoursPerDay: editing?.hoursPerDay ?? "7",
      currency: editing?.currency ?? DEFAULT_CURRENCY,
    },
  });

  const { result, submit } = useRecordedAction(form, saveSalarySettingAction, {
    keepValues: true,
  });
  const { errors } = form.formState;

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3" noValidate>
      <input type="hidden" {...form.register("month")} />

      <Field
        label={`Taux horaire — ${monthLabel}`}
        htmlFor="salary-hourly-rate"
        error={errors.hourlyRate?.message}
        hint="Le taux s'applique à partir de ce mois, jusqu'au prochain taux saisi. Tout le simulateur dérive de ce taux."
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
        hint="Longueur d'un jour cliqué (0 à 24 h), pour tous les mois. Les jours déjà cliqués gardent leurs heures."
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

      <Field
        label="Devise"
        htmlFor="salary-currency"
        error={errors.currency?.message}
        hint="Pour tous les mois."
      >
        <select id="salary-currency" className={inputClass} {...form.register("currency")}>
          {SUPPORTED_CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </Field>

      <div className="sm:col-span-3">
        <SubmitButton label="Enregistrer le taux horaire" pending={form.formState.isSubmitting} />
      </div>

      <div className="sm:col-span-3">
        <FormFeedback result={result} successMessage="Taux horaire enregistré." />
      </div>
    </form>
  );
}
