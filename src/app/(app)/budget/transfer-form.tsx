"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { FormFeedback, SubmitButton, useRecordedAction } from "@/components/forms";
import { Field, Notice, inputClass } from "@/components/ui";
import {
  transferInputSchema,
  type AccountSummary,
  type TransferInput,
} from "@/modules/budget/domain";
import { createTransferAction } from "./actions";

/**
 * One internal transfer, entered once and written as two linked movements.
 *
 * The amount is asked as a positive magnitude: the direction comes from the two accounts,
 * not from a sign. The two currencies are shown next to the selects and a mismatch is
 * flagged immediately — the server refuses it anyway (no conversion), but a warning before
 * the click beats an error after it. An empty label gets the default pair
 * (« Virement vers … » / « Virement depuis … »).
 */
export function TransferForm({
  accounts,
  today,
}: {
  accounts: AccountSummary[];
  today: string;
}) {
  const form = useForm<TransferInput>({
    resolver: zodResolver(transferInputSchema, undefined, { raw: true }),
    defaultValues: {
      fromAccountId: accounts[0]?.id ?? "",
      toAccountId: accounts[1]?.id ?? "",
      amount: "",
      operationDate: today,
      label: "",
      notes: "",
    },
  });

  const { result, submit } = useRecordedAction(form, (values) => createTransferAction(values), {
    keepValues: false,
  });
  const { errors, isSubmitting } = form.formState;

  const fromId = useWatch({ control: form.control, name: "fromAccountId" });
  const toId = useWatch({ control: form.control, name: "toAccountId" });

  const from = accounts.find((account) => account.id === fromId);
  const to = accounts.find((account) => account.id === toId);
  const sameAccount = from !== undefined && to !== undefined && from.id === to.id;
  const crossCurrency =
    from !== undefined && to !== undefined && from.currency !== to.currency;

  if (accounts.length < 2) {
    return (
      <Notice tone="info">
        Un virement lie deux comptes : il en faut au moins deux pour en enregistrer un.
        Créez le second compte ci-dessus, ou saisissez un mouvement simple dans le
        formulaire principal.
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" noValidate>
      <Field label="Compte source" htmlFor="transfer-from" error={errors.fromAccountId?.message}>
        <select id="transfer-from" className={inputClass} {...form.register("fromAccountId")}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} ({account.currency})
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Compte de destination"
        htmlFor="transfer-to"
        error={errors.toAccountId?.message}
      >
        <select id="transfer-to" className={inputClass} {...form.register("toAccountId")}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} ({account.currency})
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Montant"
        htmlFor="transfer-amount"
        error={errors.amount?.message}
        hint="Montant positif : le sens vient des deux comptes."
      >
        <input
          id="transfer-amount"
          inputMode="decimal"
          placeholder="300,00"
          className={inputClass}
          {...form.register("amount")}
        />
      </Field>

      <Field label="Date de l'opération" htmlFor="transfer-date" error={errors.operationDate?.message}>
        <input
          id="transfer-date"
          type="date"
          className={inputClass}
          {...form.register("operationDate")}
        />
      </Field>

      <Field
        label="Libellé (optionnel)"
        htmlFor="transfer-label"
        error={errors.label?.message}
        hint="Vide : « Virement vers … » / « Virement depuis … »."
      >
        <input id="transfer-label" className={inputClass} {...form.register("label")} />
      </Field>

      <Field label="Notes (optionnel)" htmlFor="transfer-notes" error={errors.notes?.message}>
        <input id="transfer-notes" className={inputClass} {...form.register("notes")} />
      </Field>

      {sameAccount ? (
        <div className="sm:col-span-2 lg:col-span-3">
          <Notice tone="warning">
            Le compte source et le compte de destination sont identiques : choisissez deux
            comptes différents.
          </Notice>
        </div>
      ) : null}

      {crossCurrency ? (
        <div className="sm:col-span-2 lg:col-span-3">
          <Notice tone="warning">
            Les deux comptes ne sont pas dans la même devise ({from?.currency} et{" "}
            {to?.currency}) : un virement lié ne traverse pas les devises, aucune
            conversion n&apos;est faite. Enregistrez deux mouvements distincts si besoin.
          </Notice>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-3">
        <SubmitButton label="Enregistrer le virement" pending={isSubmitting} />
        <FormFeedback
          result={result}
          successMessage="Virement enregistré : ses deux mouvements sont liés et se suppriment ensemble."
        />
      </div>
    </form>
  );
}
