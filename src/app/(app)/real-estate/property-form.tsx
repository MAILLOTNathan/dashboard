"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { FormFeedback, SubmitButton, useRecordedAction } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import {
  PROPERTY_OCCUPANCIES,
  propertyInputSchema,
  type PropertyInput,
  type PropertyOccupancy,
} from "@/modules/real-estate/domain";
import { createPropertyAction } from "./actions";

const OCCUPANCY_LABELS: Record<PropertyOccupancy, string> = {
  RENTED: "Loué",
  VACANT: "Vacant",
  OWNER_OCCUPIED: "Occupé par le propriétaire",
  SEASONAL: "Saisonnier",
  OTHER: "Autre",
};

/**
 * Creates a property.
 *
 * Occupancy is asked for explicitly rather than assumed: a property is not
 * necessarily rented (see AGENTS.md).
 */
export function PropertyForm() {
  const form = useForm<PropertyInput>({
    resolver: zodResolver(propertyInputSchema, undefined, { raw: true }),
    defaultValues: {
      name: "",
      address: "",
      occupancy: "VACANT",
      purchaseDate: "",
      saleDate: "",
      notes: "",
    },
  });
  const { result, submit } = useRecordedAction(form, createPropertyAction);
  const { errors, isSubmitting } = form.formState;

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" noValidate>
      <Field label="Nom du bien" htmlFor="property-name" error={errors.name?.message}>
        <input
          id="property-name"
          className={inputClass}
          autoComplete="off"
          {...form.register("name")}
        />
      </Field>

      <Field label="Occupation" htmlFor="property-occupancy" error={errors.occupancy?.message}>
        <select
          id="property-occupancy"
          className={inputClass}
          {...form.register("occupancy")}
        >
          {PROPERTY_OCCUPANCIES.map((occupancy) => (
            <option key={occupancy} value={occupancy}>
              {OCCUPANCY_LABELS[occupancy]}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Adresse"
        htmlFor="property-address"
        error={errors.address?.message}
        hint="Facultatif : une adresse n'est pas nécessaire pour suivre un bien."
      >
        <input
          id="property-address"
          className={inputClass}
          autoComplete="off"
          {...form.register("address")}
        />
      </Field>

      <Field
        label="Date d'acquisition"
        htmlFor="property-purchase-date"
        error={errors.purchaseDate?.message}
      >
        <input
          id="property-purchase-date"
          type="date"
          className={inputClass}
          {...form.register("purchaseDate")}
        />
      </Field>

      <Field
        label="Date de cession"
        htmlFor="property-sale-date"
        error={errors.saleDate?.message}
      >
        <input
          id="property-sale-date"
          type="date"
          className={inputClass}
          {...form.register("saleDate")}
        />
      </Field>

      <Field label="Notes" htmlFor="property-notes" error={errors.notes?.message}>
        <textarea id="property-notes" rows={2} className={inputClass} {...form.register("notes")} />
      </Field>

      <div className="sm:col-span-2 lg:col-span-3">
        <SubmitButton label="Ajouter le bien" pending={isSubmitting} />
      </div>

      <div className="sm:col-span-2 lg:col-span-3">
        <FormFeedback result={result} successMessage="Bien enregistré." />
      </div>
    </form>
  );
}
