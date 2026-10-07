"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import {
  confirmRecurringOccurrenceAction,
  dismissRecurringOccurrenceAction,
  skipRecurringOccurrenceAction,
} from "./forecast-actions";

/**
 * The three decisions one occurrence accepts.
 *
 * Confirm is the only one that writes a transaction — on the server, through the same
 * validation as a manual entry. Passer and Écarter write a decision of their own and no
 * ledger line, which is the point of a forecast. All three are terminal: the buttons
 * disappear with the row once the server-rendered table refreshes.
 */
export function OccurrenceActions({
  occurrenceId,
  label,
}: {
  occurrenceId: string;
  /** Named in the accessible labels so two rows never read the same. */
  label: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(action: (input: unknown) => Promise<ActionResult>): void {
    startTransition(async () => {
      setError(null);
      const outcome = await action({ id: occurrenceId });

      if (outcome.status === "ok") {
        // The table is server-rendered: refresh it so the decision shows up.
        router.refresh();
      } else {
        setError(outcome.message);
      }
    });
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <span className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => decide(confirmRecurringOccurrenceAction)}
          disabled={pending}
          aria-label={`Confirmer l'échéance « ${label} »`}
          className="rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Confirmer
        </button>
        <button
          type="button"
          onClick={() => decide(skipRecurringOccurrenceAction)}
          disabled={pending}
          aria-label={`Passer l'échéance « ${label} »`}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Passer
        </button>
        <button
          type="button"
          onClick={() => decide(dismissRecurringOccurrenceAction)}
          disabled={pending}
          aria-label={`Écarter l'échéance « ${label} »`}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Écarter
        </button>
      </span>
      {error ? (
        <span className="max-w-64 text-xs text-rose-700 dark:text-rose-400" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
