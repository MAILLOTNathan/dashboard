"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { Notice, submitClass } from "@/components/ui";
import type { ActionResult } from "@/lib/actions";

/**
 * Shared submit handling for the write forms.
 *
 * A successful result refreshes the server-rendered tables. What happens to the fields
 * is a deliberate choice per form, because the two cases pull in opposite directions:
 *
 * - A repeated entry (a transaction, a monthly charge) keeps what was typed, so the next
 *   line is a small edit rather than a full retype.
 * - A one-shot creation (an account, a category, a property) clears itself, because a
 *   leftover value in a "name" field is a trap rather than a shortcut.
 *
 * An invalid result is mapped back onto the fields: the browser already validates with
 * the same schema, so it only happens for a request that did not come from the rendered
 * form.
 */
export function useRecordedAction<TValues extends FieldValues>(
  form: UseFormReturn<TValues>,
  action: (values: TValues) => Promise<ActionResult>,
  options: { keepValues?: boolean } = {},
): { result: ActionResult | null; submit: (event?: React.BaseSyntheticEvent) => Promise<void> } {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);

  const submit = form.handleSubmit(async (values) => {
    setResult(null);
    const outcome = await action(values);

    if (outcome.status === "invalid") {
      for (const [field, messages] of Object.entries(outcome.fieldErrors)) {
        form.setError(field as Path<TValues>, {
          type: "server",
          message: messages.join(" "),
        });
      }
    }

    setResult(outcome);

    if (outcome.status === "ok") {
      if (options.keepValues) {
        // The messages of a failure must not outlive it: the fields stay, the verdict
        // of the previous attempt does not.
        form.clearErrors();
      } else {
        form.reset();
      }

      router.refresh();
    }
  });

  return { result, submit };
}

/** Renders the outcome of the last submission. Silence means "nothing sent yet". */
export function FormFeedback({
  result,
  successMessage,
}: {
  result: ActionResult | null;
  successMessage: string;
}) {
  if (!result) {
    return null;
  }

  if (result.status === "ok") {
    return <Notice tone="info">{successMessage}</Notice>;
  }

  return <Notice tone="error">{result.message}</Notice>;
}

/** Submit button that stays disabled while the action is in flight. */
export function SubmitButton({ label, pending }: { label: string; pending: boolean }) {
  return (
    <button type="submit" className={submitClass} disabled={pending}>
      {pending ? "Enregistrement..." : label}
    </button>
  );
}
