"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Notice } from "@/components/ui";
import type { ActionResult } from "@/lib/actions";
import {
  MAX_WORK_DAY_HOURS,
  MIN_WORK_DAY_HOURS,
  type WorkDayStatus,
} from "@/modules/budget/salary";
import { adjustWorkDayHoursAction, cycleWorkDayAction } from "./actions";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/** A clicked day, reduced to plain strings by the server. */
export type WorkCalendarDay = {
  /** `YYYY-MM-DD`. */
  date: string;
  status: WorkDayStatus;
  /** Decimal string, e.g. `"7.50"`. */
  hours: string;
};

function formatHours(hours: string): string {
  const value = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(
    Number(hours),
  );

  return `${value} h`;
}

/**
 * The month calendar of the salary simulator.
 *
 * The cycle is the whole interaction, so it stays in one place: one click plans the day
 * (with the configured day length), a second marks it really worked, a third erases it.
 * The +/− buttons move a day by half an hour, between 0.5 h and 24 h.
 *
 * The current state is decided by the Server Action, never sent from here: the browser
 * only names the day, so a replayed call cannot skip a level. A successful call refreshes
 * the server-rendered figures; a refusal is shown above the grid instead of being lost.
 */
export function WorkCalendar({
  cells,
  days,
  todayKey,
}: {
  /** `YYYY-MM-DD` per cell, `null` outside the month, padded to complete weeks. */
  cells: (string | null)[];
  days: WorkCalendarDay[];
  /** Highlighted day, so "today" is found without counting. */
  todayKey: string;
}) {
  const router = useRouter();
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const byDate = new Map(days.map((day) => [day.date, day]));

  function run(date: string, action: () => Promise<ActionResult>) {
    setError(null);
    setPendingDate(date);
    startTransition(async () => {
      const outcome = await action();
      setPendingDate(null);

      if (outcome.status === "ok") {
        router.refresh();
      } else {
        setError(outcome.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, index) => {
          if (date === null) {
            return <div key={`blank-${index}`} className="min-h-20 rounded-md" />;
          }

          const day = byDate.get(date);
          const isToday = date === todayKey;
          const isCellPending = isPending && pendingDate === date;
          const cycleTitle =
            day === undefined
              ? "Planifier ce jour"
              : day.status === "PLANNED"
                ? "Marquer comme travaillé"
                : "Effacer ce jour";

          const cellClass =
            day?.status === "PLANNED"
              ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
              : day?.status === "WORKED"
                ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";

          const canDecrease = day !== undefined && Number(day.hours) > MIN_WORK_DAY_HOURS.toNumber();
          const canIncrease = day !== undefined && Number(day.hours) < MAX_WORK_DAY_HOURS.toNumber();

          return (
            <div
              key={date}
              className={`min-h-20 rounded-md border p-1 ${cellClass} ${
                isToday ? "ring-2 ring-sky-400" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => run(date, () => cycleWorkDayAction({ date }))}
                disabled={isCellPending}
                title={cycleTitle}
                aria-label={`${date} : ${cycleTitle}`}
                className="flex w-full flex-col items-start gap-0.5 rounded px-0.5 py-1 text-left hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/10"
              >
                <span
                  className={`text-sm font-medium tabular-nums ${
                    isToday ? "text-sky-700 dark:text-sky-300" : ""
                  }`}
                >
                  {Number(date.slice(8, 10))}
                </span>
                {day ? (
                  <>
                    <span className="text-xs font-semibold tabular-nums">
                      {formatHours(day.hours)}
                    </span>
                    <span
                      className={`text-[10px] font-medium uppercase tracking-wide ${
                        day.status === "PLANNED"
                          ? "text-amber-700 dark:text-amber-300"
                          : "text-emerald-700 dark:text-emerald-300"
                      }`}
                    >
                      {day.status === "PLANNED" ? "Prévu" : "Travaillé"}
                    </span>
                  </>
                ) : null}
              </button>

              {day ? (
                <div className="flex justify-between gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      run(date, () => adjustWorkDayHoursAction({ date, direction: "DOWN" }))
                    }
                    disabled={isCellPending || !canDecrease}
                    title="Retirer 30 minutes"
                    aria-label={`Retirer 30 minutes au ${date}`}
                    className="h-6 w-6 rounded border border-zinc-300 text-xs leading-none hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      run(date, () => adjustWorkDayHoursAction({ date, direction: "UP" }))
                    }
                    disabled={isCellPending || !canIncrease}
                    title="Ajouter 30 minutes"
                    aria-label={`Ajouter 30 minutes au ${date}`}
                    className="h-6 w-6 rounded border border-zinc-300 text-xs leading-none hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    +
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Un clic planifie le jour (il alimente le montant prévu), un deuxième le marque
        travaillé (montant réel), un troisième l&apos;efface. Les boutons + et − ajustent
        la journée par tranches de 30 minutes, de 30 minutes à 24 h.
      </p>
    </div>
  );
}
