"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Notice, inputClass, submitClass, tdClass, thClass } from "@/components/ui";
import { addGoalContributionAction, deleteGoalContributionAction } from "./goal-actions";

/**
 * The contribution log of one manual goal: add a dated amount, list what was logged,
 * remove a mistake.
 *
 * A contribution never touches the ledger: it is a log entry that adds to the goal's
 * starting amount, and the progress on the row moves by exactly what is logged. The form
 * is collapsed by default — a goal is consulted far more often than it is contributed to.
 * Deleting asks for a second click, like every deletion in the dashboard.
 */

export type GoalContributionRow = {
  id: string;
  amountLabel: string;
  dateLabel: string;
  note: string | null;
};

export function GoalContributions({
  goalId,
  contributions,
  totalCount,
  totalLabel,
  truncated,
  today,
}: {
  goalId: string;
  /** Latest contributions, already formatted and bounded by the server. */
  contributions: GoalContributionRow[];
  /** Exact count from the aggregate, never from the bounded list. */
  totalCount: number;
  /** Formatted sum, or "—" when nothing was logged. */
  totalLabel: string;
  /** True when the list is shorter than the exact count. */
  truncated: boolean;
  /** `YYYY-MM-DD` default for the date input. */
  today: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    setMessage(null);
    startTransition(async () => {
      const outcome = await addGoalContributionAction({ goalId, amount, date, note });

      if (outcome.status === "ok") {
        setAmount("");
        setNote("");
        setMessage({ tone: "info", text: "Contribution enregistrée." });
        router.refresh();
        return;
      }

      const text =
        outcome.status === "invalid"
          ? Object.values(outcome.fieldErrors).flat()[0] ?? outcome.message
          : outcome.message;
      setMessage({ tone: "error", text });
    });
  }

  function remove(id: string) {
    setMessage(null);
    startTransition(async () => {
      const outcome = await deleteGoalContributionAction({ id });
      setConfirmingId(null);

      if (outcome.status === "ok") {
        setMessage({ tone: "info", text: "Contribution supprimée : la progression recule d'autant." });
        router.refresh();
        return;
      }

      setMessage({ tone: "error", text: outcome.message });
    });
  }

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-zinc-600 dark:text-zinc-400">
        Contributions ({totalCount}) — {totalLabel}
      </summary>

      <div className="mt-2 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">Montant</span>
            <input
              className={inputClass}
              inputMode="decimal"
              placeholder="150,00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">Date</span>
            <input
              type="date"
              className={inputClass}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs">
            <span className="font-medium">Note (facultative)</span>
            <input
              className={inputClass}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button type="button" onClick={add} disabled={pending || amount.trim() === ""} className={submitClass}>
            {pending ? "..." : "Ajouter la contribution"}
          </button>
        </div>

        {message ? (
          <Notice tone={message.tone === "error" ? "error" : "info"}>{message.text}</Notice>
        ) : null}

        {contributions.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Aucune contribution journalisée : la progression ne tient compte que du montant
            de départ.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-xs">
              <caption className="sr-only">Contributions journalisées</caption>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>
                    Date
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Montant
                  </th>
                  <th scope="col" className={thClass}>
                    Note
                  </th>
                  <th scope="col" className={thClass}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {contributions.map((contribution) => (
                  <tr key={contribution.id}>
                    <td className={`${tdClass} whitespace-nowrap`}>{contribution.dateLabel}</td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {contribution.amountLabel}
                    </td>
                    <td className={tdClass}>{contribution.note ?? "—"}</td>
                    <td className={tdClass}>
                      {confirmingId === contribution.id ? (
                        <span className="flex items-center gap-1">
                          <span>Supprimer ?</span>
                          <button
                            type="button"
                            onClick={() => remove(contribution.id)}
                            disabled={pending}
                            className="rounded-md bg-rose-700 px-2 py-0.5 font-medium text-white disabled:opacity-60"
                          >
                            Oui
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingId(null)}
                            className="rounded-md border border-zinc-300 px-2 py-0.5 dark:border-zinc-700"
                          >
                            Non
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingId(contribution.id)}
                          className="rounded-md border border-zinc-300 px-2 py-0.5 dark:border-zinc-700"
                        >
                          Supprimer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {truncated ? (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Liste limitée aux contributions les plus récentes ; le compteur et le total
                restent exacts.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </details>
  );
}
