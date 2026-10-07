"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRecordedAction } from "@/components/forms";
import { inputClass } from "@/components/ui";
import {
  salaryBookingFormSchema,
  type SalaryBookingFormValues,
} from "@/modules/budget/salary";
import { bookSalaryAction } from "./actions";

/**
 * Registration control of the salary row, inside the échéances table.
 *
 * Same contract and same action as the Salaire tab's form: the amount is recomputed
 * server-side from the month's clicked days, so the row can never register a figure the
 * calendar did not produce. The layout is reduced to what a table cell can hold — two
 * fields with accessible labels and one button — because the amount and the composition
 * are already on the row itself.
 */
export function SalaryBookingRow({
  monthKey,
  accounts,
  defaultDate,
}: {
  monthKey: string;
  /** Active accounts in the salary currency — the action refuses any other. */
  accounts: { id: string; name: string }[];
  /** Last clicked day of the month, the default operation date. */
  defaultDate: string;
}) {
  const form = useForm<SalaryBookingFormValues>({
    resolver: zodResolver(salaryBookingFormSchema, undefined, { raw: true }),
    defaultValues: { accountId: accounts[0]?.id ?? "", date: defaultDate },
  });

  const { result, submit } = useRecordedAction(form, (values) =>
    bookSalaryAction({ month: monthKey, ...values }),
  );
  const { errors, isSubmitting } = form.formState;
  const fieldError = errors.accountId?.message ?? errors.date?.message;

  return (
    <form onSubmit={submit} className="flex flex-col items-start gap-1" noValidate>
      <select
        aria-label="Compte à créditer"
        className={inputClass}
        {...form.register("accountId")}
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>

      <input
        type="date"
        aria-label="Date de l'opération"
        className={inputClass}
        {...form.register("date")}
      />

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {isSubmitting ? "Enregistrement..." : "Enregistrer la recette"}
      </button>

      {result && result.status !== "ok" ? (
        <span className="max-w-56 text-xs text-rose-700 dark:text-rose-400" role="alert">
          {fieldError ?? result.message}
        </span>
      ) : null}
    </form>
  );
}
