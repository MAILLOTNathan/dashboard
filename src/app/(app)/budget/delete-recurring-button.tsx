"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import { deleteRecurringEntryAction } from "./forecast-actions";

/**
 * Removes one recurring series, in two steps.
 *
 * The confirmation is a state of this button rather than a `window.confirm`, like the
 * other deletions: it names the series about to disappear. The server refuses as soon
 * as an occurrence carries a decision — that audit trail outlives the series — and the
 * refusal arrives here as a readable message.
 */
export function DeleteRecurringButton({
  entryId,
  label,
}: {
  entryId: string;
  /** Shown in the confirmation so the row is unambiguous. */
  label: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(): void {
    startTransition(async () => {
      const outcome = await deleteRecurringEntryAction({ id: entryId });
      setResult(outcome);

      if (outcome.status === "ok") {
        setConfirming(false);
        // The table is server-rendered: refresh it so the row disappears.
        router.refresh();
      }
    });
  }

  if (!confirming) {
    return (
      <span className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setConfirming(true);
          }}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Supprimer
        </button>
        {result && result.status !== "ok" ? (
          <span className="max-w-64 text-xs text-rose-700 dark:text-rose-400" role="alert">
            {result.message}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <span className="text-xs">Supprimer la série « {label} » ?</span>
      <span className="flex gap-1">
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="rounded-md bg-rose-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
        >
          {pending ? "Suppression..." : "Confirmer"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Annuler
        </button>
      </span>
      {result && result.status !== "ok" ? (
        <span className="max-w-64 text-xs text-rose-700 dark:text-rose-400" role="alert">
          {result.message}
        </span>
      ) : null}
    </span>
  );
}
