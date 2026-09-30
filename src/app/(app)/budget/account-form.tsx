"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { FormFeedback, SubmitButton, useRecordedAction } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import {
  ACCOUNT_TYPES,
  accountInputSchema,
  type AccountInput,
  type AccountType,
} from "@/modules/budget/domain";
import { createAccountAction } from "./actions";

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CHECKING: "Compte courant",
  SAVINGS: "Épargne",
  CASH: "Espèces",
  CREDIT_CARD: "Carte de crédit",
  OTHER: "Autre",
};

/**
 * Creates a manually tracked account.
 *
 * A transaction needs an account, so this is the first form to fill in on an
 * empty dashboard. No banking credential is asked for: balances are typed in.
 */
export function AccountForm() {
  const form = useForm<AccountInput>({
    resolver: zodResolver(accountInputSchema, undefined, { raw: true }),
    defaultValues: { name: "", type: "CHECKING", currency: "EUR" },
  });
  const { result, submit } = useRecordedAction(form, createAccountAction);
  const { errors, isSubmitting } = form.formState;

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3" noValidate>
      <Field label="Nom du compte" htmlFor="account-name" error={errors.name?.message}>
        <input
          id="account-name"
          className={inputClass}
          autoComplete="off"
          {...form.register("name")}
        />
      </Field>

      <Field label="Type" htmlFor="account-type" error={errors.type?.message}>
        <select id="account-type" className={inputClass} {...form.register("type")}>
          {ACCOUNT_TYPES.map((type) => (
            <option key={type} value={type}>
              {ACCOUNT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Devise" htmlFor="account-currency" error={errors.currency?.message}>
        <select id="account-currency" className={inputClass} {...form.register("currency")}>
          {SUPPORTED_CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </Field>

      <div className="sm:col-span-3">
        <SubmitButton label="Ajouter le compte" pending={isSubmitting} />
      </div>

      <div className="sm:col-span-3">
        <FormFeedback result={result} successMessage="Compte enregistré." />
      </div>
    </form>
  );
}
