"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { FormFeedback, SubmitButton, useRecordedAction } from "@/components/forms";
import { Field, Notice, inputClass } from "@/components/ui";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import {
  CASHFLOW_KINDS,
  cashflowInputSchema,
  type CashflowInput,
  type CashflowKind,
} from "@/modules/real-estate/domain";
import { createCashflowAction } from "./actions";

const KIND_LABELS: Record<CashflowKind, string> = {
  INCOME: "Recette (loyer, charges refacturées)",
  EXPENSE: "Charge (travaux, taxe, assurance)",
};

/** A transaction reduced to what the selector needs: never send a Decimal to the browser. */
export type TransactionOption = {
  id: string;
  label: string;
  date: string;
  /** Already formatted, currency symbol included: display only. */
  amountText: string;
};

/**
 * Creates a cashflow entry for a property.
 *
 * A charge or a rent is either a standalone amount or a link to a transaction
 * already recorded in the budget — never both, otherwise the property total would
 * count the same money twice. Linking hides the amount and the currency fields:
 * the transaction is then the single source of truth.
 */
export function CashflowForm({
  properties,
  transactions,
}: {
  properties: { id: string; name: string }[];
  transactions: TransactionOption[];
}) {
  const form = useForm<CashflowInput>({
    resolver: zodResolver(cashflowInputSchema, undefined, { raw: true }),
    defaultValues: {
      propertyId: properties[0]?.id ?? "",
      kind: "EXPENSE",
      label: "",
      amount: "",
      transactionId: "",
      currency: "EUR",
      dueDate: "",
      settledAt: "",
      notes: "",
    },
  });
  const { result, submit } = useRecordedAction(form, createCashflowAction);
  const { errors, isSubmitting } = form.formState;

  const transactionId = useWatch({ control: form.control, name: "transactionId" });
  const isLinked = Boolean(transactionId);

  // Same rule as the transaction form: adopt the first property, never override a choice.
  useEffect(() => {
    if (!form.getValues("propertyId") && properties[0]) {
      form.setValue("propertyId", properties[0].id);
    }
  }, [properties, form]);

  if (properties.length === 0) {
    return (
      <Notice tone="warning">
        Aucun bien n&apos;est enregistré. Ajoutez un bien avant de saisir un flux.
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" noValidate>
      <Field label="Bien" htmlFor="cashflow-property" error={errors.propertyId?.message}>
        <select id="cashflow-property" className={inputClass} {...form.register("propertyId")}>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Nature" htmlFor="cashflow-kind" error={errors.kind?.message}>
        <select id="cashflow-kind" className={inputClass} {...form.register("kind")}>
          {CASHFLOW_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Libellé"
        htmlFor="cashflow-label"
        error={errors.label?.message}
        hint="Par exemple : taxe foncière 2026, loyer de septembre."
      >
        <input
          id="cashflow-label"
          className={inputClass}
          autoComplete="off"
          {...form.register("label")}
        />
      </Field>

      {isLinked ? null : (
        <>
          <Field
            label="Montant"
            htmlFor="cashflow-amount"
            error={errors.amount?.message}
            hint="Signé comme dans le budget : une charge est négative, une recette positive."
          >
            <input
              id="cashflow-amount"
              className={inputClass}
              inputMode="decimal"
              placeholder="-450,00"
              autoComplete="off"
              {...form.register("amount", {
                // Choosing a transaction clears the amount: the two are exclusive.
                onChange: () => form.setValue("transactionId", ""),
              })}
            />
          </Field>

          <Field label="Devise" htmlFor="cashflow-currency" error={errors.currency?.message}>
            <select id="cashflow-currency" className={inputClass} {...form.register("currency")}>
              {SUPPORTED_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      <Field
        label="Transaction liée"
        htmlFor="cashflow-transaction"
        error={errors.transactionId?.message}
        hint={
          isLinked
            ? "Le montant et la devise sont repris de la transaction : rien à saisir ici."
            : "Facultatif. Rattachez une opération du budget au lieu de saisir un montant."
        }
      >
        <select
          id="cashflow-transaction"
          className={inputClass}
          {...form.register("transactionId", {
            onChange: (event) => {
              if (event.target.value !== "") {
                form.setValue("amount", "");
              }
            },
          })}
        >
          <option value="">Aucune : montant saisi ci-dessus</option>
          {transactions.map((transaction) => (
            <option key={transaction.id} value={transaction.id}>
              {transaction.date} — {transaction.label} ({transaction.amountText})
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Échéance"
        htmlFor="cashflow-due-date"
        error={errors.dueDate?.message}
        hint="Facultatif : une échéance dépassée et non réglée est signalée."
      >
        <input
          id="cashflow-due-date"
          type="date"
          className={inputClass}
          {...form.register("dueDate")}
        />
      </Field>

      <Field label="Réglé le" htmlFor="cashflow-settled-at" error={errors.settledAt?.message}>
        <input
          id="cashflow-settled-at"
          type="date"
          className={inputClass}
          {...form.register("settledAt")}
        />
      </Field>

      <Field label="Notes" htmlFor="cashflow-notes" error={errors.notes?.message}>
        <textarea id="cashflow-notes" rows={2} className={inputClass} {...form.register("notes")} />
      </Field>

      <div className="sm:col-span-2 lg:col-span-3">
        <SubmitButton label="Ajouter le flux" pending={isSubmitting} />
      </div>

      <div className="sm:col-span-2 lg:col-span-3">
        <FormFeedback result={result} successMessage="Flux enregistré." />
      </div>
    </form>
  );
}
