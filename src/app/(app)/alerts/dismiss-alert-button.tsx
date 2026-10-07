"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dismissAlertAction } from "./actions";

/**
 * Dismisses one alert.
 *
 * One click is enough on purpose: dismissing changes nothing about the data, it only
 * silences a warning. The condition itself decides when the alert may return — once it
 * resolves and triggers again, it reopens as a fresh episode.
 *
 * The action validates on its own: this component is a comfort, not a guard.
 */
export function DismissAlertButton({ alertId }: { alertId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function dismiss(): void {
    startTransition(async () => {
      const outcome = await dismissAlertAction({ id: alertId });

      if (outcome.status === "ok") {
        // The list is server-rendered: refresh it so the alert moves to the history.
        router.refresh();
        return;
      }

      setError(outcome.message);
    });
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={dismiss}
        disabled={pending}
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {pending ? "…" : "Écarter"}
      </button>
      {error ? (
        <span className="text-xs text-rose-700 dark:text-rose-400" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
