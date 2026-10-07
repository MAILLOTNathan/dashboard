"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Notice } from "@/components/ui";
import type { ActionResult } from "@/lib/actions";
import { copyBudgetsAction } from "./actions";

/**
 * Copies the previous month's budgets onto the displayed one.
 *
 * Safe to replay and safe to click when the month is already partly filled: only missing
 * envelopes are created, and the answer says how many were left as they are. An empty
 * previous month answers plainly — it is not an error, there is simply no model yet.
 */
export function CopyBudgetsButton({
  monthKey,
  previousLabel,
}: {
  /** `YYYY-MM` of the month being displayed — the copy target. */
  monthKey: string;
  /** French label of the source month, for the button text. */
  previousLabel: string;
}) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function copy() {
    setResult(null);
    startTransition(async () => {
      const outcome = await copyBudgetsAction({ month: monthKey });
      setResult(outcome);

      if (outcome.status === "ok") {
        router.refresh();
      }
    });
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={copy}
        disabled={pending}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {pending ? "Copie..." : `Copier les budgets de ${previousLabel}`}
      </button>
      {result ? (
        <Notice tone={result.status === "error" ? "error" : "info"}>
          {result.status === "ok" ? (result.message ?? "Budgets copiés.") : result.message}
        </Notice>
      ) : null}
    </span>
  );
}
