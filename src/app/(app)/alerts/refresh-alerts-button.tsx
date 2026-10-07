"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Re-runs the evaluation pass.
 *
 * The page already evaluates while rendering; this button is for the moment just after
 * a write (a transaction, a sync) when the owner wants the warnings to catch up without
 * leaving the page. A server-component refresh re-executes the pass on the server.
 */
export function RefreshAlertsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      {pending ? "Vérification..." : "Revérifier"}
    </button>
  );
}
