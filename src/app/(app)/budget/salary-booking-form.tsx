"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { FormFeedback, SubmitButton, useRecordedAction } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import {
  salaryBookingFormSchema,
  type SalaryBookingFormValues,
} from "@/modules/budget/salary";
import { bookSalaryAction } from "./actions";

/**
 * Turns the month's simulated hours into a real income entry.
 *
 * Only the account and the date are asked for: the amount is recomputed on the server
 * from the clicked days (planned and worked, each counted once), and the category
 * (created when missing) and the import reference are decided there too, so a replayed
 * request can neither invent an amount nor record the month twice. The amount is shown
 * next to the account because booking a figure should never be a blind click.
 */
export function SalaryBookingForm({
  monthKey,
  accounts,
  defaultDate,
  amountLabel,
}: {
  monthKey: string;
  /** Active accounts in the salary currency — the action refuses any other. */
  accounts: { id: string; name: string }[];
  /** Last worked day of the month, used as the operation date by default. */
  defaultDate: string;
  /** The amount about to be recorded, formatted for the hint. */
  amountLabel: string;
}) {
  const form = useForm<SalaryBookingFormValues>({
    resolver: zodResolver(salaryBookingFormSchema, undefined, { raw: true }),
    defaultValues: { accountId: accounts[0]?.id ?? "", date: defaultDate },
  });

  const { result, submit } = useRecordedAction(form, (values) =>
    bookSalaryAction({ month: monthKey, ...values }),
  );
  const { errors, isSubmitting } = form.formState;

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3" noValidate>
      <Field
        label="Compte à créditer"
        htmlFor="booking-account"
        error={errors.accountId?.message}
        hint={`Montant enregistré : ${amountLabel}, calculé sur les jours cliqués du mois.`}
      >
        <select id="booking-account" className={inputClass} {...form.register("accountId")}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Date de l'opération"
        htmlFor="booking-date"
        error={errors.date?.message}
        hint="Par défaut, le dernier jour cliqué du mois."
      >
        <input id="booking-date" type="date" className={inputClass} {...form.register("date")} />
      </Field>

      <div className="flex items-end">
        <SubmitButton label="Ajouter la recette « Salaire »" pending={isSubmitting} />
      </div>

      <div className="sm:col-span-3">
        <FormFeedback
          result={result}
          successMessage="Recette enregistrée : elle apparaît dans l'onglet Opérations."
        />
      </div>
    </form>
  );
}
