"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import { deleteTransactionAction } from "./actions";

/**
 * Removes one transaction, in two steps.
 *
 * The confirmation is a state of this button rather than a `window.confirm`: it stays
 * inside the page, it can be styled and read by a screen reader, and the second step
 * names what is about to disappear. Deleting a financial line is irreversible here —
 * there is no bin — so one deliberate click is not enough.
 *
 * The action also validates on its own: this component is a comfort, not a guard.
 */
export function DeleteTransactionButton({
  transactionId,
  label,
}: {
  transactionId: string;
  /** Shown in the confirmation so the row is unambiguous. */
  label: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(): void {
    startTransition(async () => {
      const outcome = await deleteTransactionAction({ id: transactionId });
      setResult(outcome);

      if (outcome.status === "ok") {
        setConfirming(false);
        // The tables and the indicators are server-rendered: refresh them.
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
          <span className="text-xs text-rose-700 dark:text-rose-400" role="alert">
            {result.message}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <span className="text-xs">Supprimer « {label} » ?</span>
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
        <span className="max-w-56 text-xs text-rose-700 dark:text-rose-400" role="alert">
          {result.message}
        </span>
      ) : null}
    </span>
  );
}
