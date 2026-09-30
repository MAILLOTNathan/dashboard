"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { FormFeedback, SubmitButton, useRecordedAction } from "@/components/forms";
import { Field, Notice, inputClass } from "@/components/ui";
import {
  TRANSACTION_TYPES,
  transactionFormSchema,
  type AccountSummary,
  type CategorySummary,
  type TransactionFormValues,
  type TransactionType,
} from "@/modules/budget/domain";
import { createTransactionAction } from "./actions";

const TYPE_LABELS: Record<TransactionType, string> = {
  INCOME: "Recette",
  EXPENSE: "Dépense",
  TRANSFER: "Transfert entre comptes",
};

/**
 * Creates a transaction.
 *
 * The currency is not asked for: it is the currency of the selected account, and
 * the server reads it from there. The sign is asked for instead, because it
 * carries the meaning (see the hint under the amount).
 */
export function TransactionForm({
  accounts,
  categories,
  today,
}: {
  accounts: AccountSummary[];
  categories: CategorySummary[];
  today: string;
}) {
  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema, undefined, { raw: true }),
    defaultValues: {
      accountId: accounts[0]?.id ?? "",
      categoryId: "",
      type: "EXPENSE",
      label: "",
      amount: "",
      operationDate: today,
      notes: "",
    },
  });
  const { result, submit } = useRecordedAction(form, createTransactionAction);
  const { errors, isSubmitting } = form.formState;

  const selectedAccountId = useWatch({ control: form.control, name: "accountId" });
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);

  // The account list grows while this form is mounted (the account form sits just
  // above): adopt the first account without ever overriding a chosen one.
  useEffect(() => {
    if (!form.getValues("accountId") && accounts[0]) {
      form.setValue("accountId", accounts[0].id);
    }
  }, [accounts, form]);

  if (accounts.length === 0) {
    return (
      <Notice tone="warning">
        Aucun compte n&apos;est enregistré. Créez un compte avant de saisir une opération.
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" noValidate>
      <Field label="Compte" htmlFor="transaction-account" error={errors.accountId?.message}>
        <select
          id="transaction-account"
          className={inputClass}
          {...form.register("accountId")}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} ({account.currency})
            </option>
          ))}
        </select>
      </Field>

      <Field label="Type" htmlFor="transaction-type" error={errors.type?.message}>
        <select id="transaction-type" className={inputClass} {...form.register("type")}>
          {TRANSACTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Date de l'opération"
        htmlFor="transaction-date"
        error={errors.operationDate?.message}
      >
        <input
          id="transaction-date"
          type="date"
          className={inputClass}
          {...form.register("operationDate")}
        />
      </Field>

      <Field label="Libellé" htmlFor="transaction-label" error={errors.label?.message}>
        <input
          id="transaction-label"
          className={inputClass}
          autoComplete="off"
          {...form.register("label")}
        />
      </Field>

      <Field
        label="Montant"
        htmlFor="transaction-amount"
        error={errors.amount?.message}
        hint={
          selectedAccount
            ? `En ${selectedAccount.currency}. Une sortie est négative : -45,90. Un montant positif sur une dépense est un remboursement.`
            : undefined
        }
      >
        <input
          id="transaction-amount"
          className={inputClass}
          inputMode="decimal"
          placeholder="-45,90"
          autoComplete="off"
          {...form.register("amount")}
        />
      </Field>

      <Field label="Catégorie" htmlFor="transaction-category" error={errors.categoryId?.message}>
        <select
          id="transaction-category"
          className={inputClass}
          {...form.register("categoryId")}
        >
          <option value="">Aucune</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Notes"
        htmlFor="transaction-notes"
        error={errors.notes?.message}
        hint="Facultatif, 2000 caractères maximum."
      >
        <textarea id="transaction-notes" rows={2} className={inputClass} {...form.register("notes")} />
      </Field>

      <div className="sm:col-span-2 lg:col-span-3">
        <SubmitButton label="Enregistrer l'opération" pending={isSubmitting} />
      </div>

      <div className="sm:col-span-2 lg:col-span-3">
        <FormFeedback result={result} successMessage="Opération enregistrée." />
      </div>
    </form>
  );
}
