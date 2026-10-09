"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { FormFeedback, SubmitButton, useRecordedAction } from "@/components/forms";
import { Field, Notice, inputClass } from "@/components/ui";
import {
  categoryKindForTransactionType,
  TRANSACTION_TYPES,
  transactionFormSchema,
  type AccountSummary,
  type CategoryKind,
  type CategorySummary,
  type TransactionFormInitialValues,
  type TransactionFormValues,
  type TransactionType,
} from "@/modules/budget/domain";
import { createTransactionAction, updateTransactionAction } from "./actions";

const TYPE_LABELS: Record<TransactionType, string> = {
  INCOME: "Recette",
  EXPENSE: "Dépense",
  TRANSFER: "Transfert entre comptes",
};

const KIND_LABEL: Record<CategoryKind, string> = {
  INCOME: "recette",
  EXPENSE: "dépense",
};

/**
 * Types a transaction, or corrects one.
 *
 * One component for both, because an edition is the same fields with values already in
 * them: two components would be the same code twice, and the copies would eventually
 * disagree about a rule.
 *
 * The currency is not asked for: it is the currency of the selected account, and the
 * server reads it from there. The sign is asked for instead, because it carries the
 * meaning (see the hint under the amount).
 *
 * The label field offers the labels already used (see `buildLabelSuggestions`): typing
 * the same words every month is the most repetitive part of keeping a budget. The list
 * is a native `datalist`, so it filters itself as the text is typed, works with the
 * keyboard, and adds no dependency.
 *
 * A successful submission keeps the values in place, so a second line of the same day is
 * a small edit rather than a full retype.
 */
export function TransactionForm({
  accounts,
  categories,
  labelSuggestions,
  today,
  editing = null,
  duplicateOf = null,
  linkedPropertyName = null,
  cancelHref,
}: {
  accounts: AccountSummary[];
  categories: CategorySummary[];
  /** Past labels, already ranked and capped by the budget module. */
  labelSuggestions: string[];
  today: string;
  /**
   * The row being corrected, already reduced to plain strings by the server: a `Decimal`
   * or a `Date` cannot cross into this component at all.
   */
  editing?: TransactionFormInitialValues | null;
  /**
   * The row being duplicated: the creation form is seeded with its values (date
   * included), and nothing is written until the owner submits. Mutually exclusive with
   * `editing` — the server never sets both.
   */
  duplicateOf?: TransactionFormInitialValues | null;
  /** Property whose cashflow reads this transaction, when there is one. */
  linkedPropertyName?: string | null;
  /** Where "Annuler" returns to, filters preserved. Used while editing. */
  cancelHref?: string;
}) {
  const isEditing = editing !== null;

  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema, undefined, { raw: true }),
    defaultValues: editing
      ? {
          accountId: editing.accountId,
          categoryId: editing.categoryId,
          type: editing.type,
          label: editing.label,
          amount: editing.amount,
          operationDate: editing.operationDate,
          notes: editing.notes,
        }
      : duplicateOf
        ? {
            accountId: duplicateOf.accountId,
            categoryId: duplicateOf.categoryId,
            type: duplicateOf.type,
            label: duplicateOf.label,
            amount: duplicateOf.amount,
            // The date is copied too: a duplicated line is usually the same day's
            // story again (a split, a corrected repeat), and the notice asks to check.
            operationDate: duplicateOf.operationDate,
            notes: duplicateOf.notes,
          }
        : {
            accountId: accounts[0]?.id ?? "",
            categoryId: "",
            type: "EXPENSE",
            label: "",
            amount: "",
            operationDate: today,
            notes: "",
          },
  });

  // The identifier is added here rather than kept in a hidden field: the form values stay
  // the creation contract, and only the action they are sent to distinguishes the cases.
  const { result, submit } = useRecordedAction(
    form,
    (values) =>
      editing
        ? updateTransactionAction({ ...values, id: editing.id })
        : createTransactionAction(values),
    { keepValues: true },
  );
  const { errors, isSubmitting } = form.formState;
  const [droppedCategory, setDroppedCategory] = useState<string | null>(null);

  const selectedAccountId = useWatch({ control: form.control, name: "accountId" });
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);
  const selectedType = useWatch({ control: form.control, name: "type" });

  // The rule lives in the module, so the form and the server cannot disagree.
  const categoryKind = categoryKindForTransactionType(selectedType ?? "EXPENSE");
  const selectableCategories = categories.filter(
    (category) => category.kind === categoryKind,
  );

  // The account list grows while this form is mounted (the account form sits just
  // above): adopt the first account without ever overriding a chosen one.
  useEffect(() => {
    if (!form.getValues("accountId") && accounts[0]) {
      form.setValue("accountId", accounts[0].id);
    }
  }, [accounts, form]);

  // Changing the type must not keep a category of the other kind selected: the server
  // would refuse the record anyway, and a stale choice is easy to miss. The removal is
  // announced rather than silent.
  function handleTypeChange(event: React.ChangeEvent<HTMLSelectElement>): void {
    const chosenId = form.getValues("categoryId");
    const nextKind = categoryKindForTransactionType(event.target.value as TransactionType);

    if (!chosenId) {
      setDroppedCategory(null);
      return;
    }

    const chosen = categories.find((category) => category.id === chosenId);

    if (chosen && chosen.kind === nextKind) {
      setDroppedCategory(null);
      return;
    }

    form.setValue("categoryId", "");
    setDroppedCategory(chosen?.name ?? "La catégorie sélectionnée");
  }

  if (accounts.length === 0) {
    return (
      <Notice tone="warning">
        Aucun compte n&apos;est enregistré. Créez un compte avant de saisir une opération.
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" noValidate>
      {duplicateOf && !isEditing ? (
        <div className="sm:col-span-2 lg:col-span-3">
          <Notice tone="info">
            Copie de « {duplicateOf.label} » : les valeurs sont préremplies, date comprise.
            Rien n&apos;est enregistré tant que vous ne validez pas.
          </Notice>
        </div>
      ) : null}

      {linkedPropertyName ? (
        <div className="sm:col-span-2 lg:col-span-3">
          <Notice tone="warning">
            Cette opération est rattachée au flux du bien « {linkedPropertyName} » : modifier
            son montant change aussi les totaux de l&apos;immobilier.
          </Notice>
        </div>
      ) : null}

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
        <select
          id="transaction-type"
          className={inputClass}
          {...form.register("type", { onChange: handleTypeChange })}
        >
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

      <Field
        label="Libellé"
        htmlFor="transaction-label"
        error={errors.label?.message}
        hint={
          labelSuggestions.length > 0
            ? "Vos libellés précédents sont proposés : la liste se filtre à la saisie."
            : undefined
        }
      >
        <input
          id="transaction-label"
          list="transaction-label-suggestions"
          className={inputClass}
          autoComplete="off"
          {...form.register("label")}
        />
        {labelSuggestions.length > 0 ? (
          <datalist id="transaction-label-suggestions">
            {labelSuggestions.map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
        ) : null}
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

      {categoryKind === null ? (
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Catégorie</span>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Un transfert entre comptes n&apos;est ni une recette ni une dépense : aucune
            catégorie ne s&apos;applique.
          </p>
        </div>
      ) : (
        <Field
          label="Catégorie"
          htmlFor="transaction-category"
          error={errors.categoryId?.message}
          hint={
            selectableCategories.length === 0
              ? `Aucune catégorie de type ${KIND_LABEL[categoryKind]} n'existe encore : créez-en une dans « Nouvelle catégorie » ci-dessous.`
              : `Seules les catégories de type ${KIND_LABEL[categoryKind]} sont proposées, pour rester cohérentes avec le type de l'opération.`
          }
        >
          <select
            id="transaction-category"
            className={inputClass}
            {...form.register("categoryId", {
              onChange: () => setDroppedCategory(null),
            })}
          >
            <option value="">Aucune</option>
            {selectableCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field
        label="Notes"
        htmlFor="transaction-notes"
        error={errors.notes?.message}
        hint="Facultatif, 2000 caractères maximum."
      >
        <textarea id="transaction-notes" rows={2} className={inputClass} {...form.register("notes")} />
      </Field>

      <div className="sm:col-span-2 lg:col-span-3">
        {droppedCategory && categoryKind !== null ? (
          <Notice tone="warning">
            Catégorie « {droppedCategory} » retirée : elle ne correspond pas au type
            sélectionné. Choisissez une catégorie du bon type, ou aucune.
          </Notice>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
        <SubmitButton
          label={isEditing ? "Enregistrer les modifications" : "Enregistrer l'opération"}
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
          successMessage={
            isEditing ? "Modification enregistrée." : "Opération enregistrée."
          }
        />
      </div>
    </form>
  );
}
