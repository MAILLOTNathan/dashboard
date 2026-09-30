"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { FormFeedback, SubmitButton, useRecordedAction } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import {
  CATEGORY_KINDS,
  categoryInputSchema,
  type CategoryInput,
  type CategoryKind,
} from "@/modules/budget/domain";
import { createCategoryAction } from "./actions";

const CATEGORY_KIND_LABELS: Record<CategoryKind, string> = {
  INCOME: "Recette",
  EXPENSE: "Dépense",
};

/** Creates a category. Categories are optional on a transaction, filters are not. */
export function CategoryForm() {
  const form = useForm<CategoryInput>({
    resolver: zodResolver(categoryInputSchema, undefined, { raw: true }),
    defaultValues: { name: "", kind: "EXPENSE" },
  });
  const { result, submit } = useRecordedAction(form, createCategoryAction);
  const { errors, isSubmitting } = form.formState;

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3" noValidate>
      <Field
        label="Nom de la catégorie"
        htmlFor="category-name"
        error={errors.name?.message}
      >
        <input
          id="category-name"
          className={inputClass}
          autoComplete="off"
          {...form.register("name")}
        />
      </Field>

      <Field label="Nature" htmlFor="category-kind" error={errors.kind?.message}>
        <select id="category-kind" className={inputClass} {...form.register("kind")}>
          {CATEGORY_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {CATEGORY_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex items-end">
        <SubmitButton label="Ajouter la catégorie" pending={isSubmitting} />
      </div>

      <div className="sm:col-span-3">
        <FormFeedback result={result} successMessage="Catégorie enregistrée." />
      </div>
    </form>
  );
}
