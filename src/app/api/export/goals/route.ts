import { requireApiUser, unauthorizedResponse } from "@/lib/auth/guard";
import { createCsvResponse, EXPORT_ROW_LIMIT, toCsv, type CsvColumn } from "@/lib/csv";
import { toDateOnlyString } from "@/lib/dates";
import {
  computeGoalProgress,
  GOAL_STATUSES,
  type GoalProgress,
} from "@/modules/budget/goals";
import { listGoals, readAccountBalance } from "@/modules/budget/repository";

/**
 * CSV export of the financial goals, with the same progress rules as the screen.
 *
 * `status` filters the file (`ACTIVE`, `ACHIEVED`, `ABANDONED`); an absent or unknown
 * value exports everything, the way the transactions export ignores an unknown type.
 *
 * An unknown current amount is written as an **empty cell**, never as a zero: the
 * `note` column carries the reason (or the why of a missing monthly contribution), and
 * the numeric columns simply stay blank. The read is bounded by `EXPORT_ROW_LIMIT`.
 */
export const dynamic = "force-dynamic";

type GoalRow = {
  name: string;
  currency: string;
  targetAmount: string;
  targetDate: string;
  status: string;
  source: string;
  account: string;
  current: string;
  percent: string;
  remaining: string;
  contribution: string;
  note: string;
};

const COLUMNS: CsvColumn<GoalRow>[] = [
  { key: "name", header: "nom" },
  { key: "currency", header: "devise" },
  { key: "targetAmount", header: "montant_cible" },
  { key: "targetDate", header: "date_cible" },
  { key: "status", header: "statut" },
  { key: "source", header: "source_montant_actuel" },
  { key: "account", header: "compte" },
  { key: "current", header: "montant_actuel" },
  { key: "percent", header: "progression_pourcent" },
  { key: "remaining", header: "reste" },
  { key: "contribution", header: "contribution_mensuelle" },
  { key: "note", header: "note" },
];

/** How the current amount is sourced, in the same words the screen uses. */
function sourceLabel(goal: { currentAmount: unknown; accountId: string | null }): string {
  if (goal.currentAmount !== null) {
    return "saisi";
  }

  return goal.accountId === null ? "aucune" : "compte";
}

function numericCells(progress: GoalProgress): Pick<
  GoalRow,
  "current" | "percent" | "remaining" | "contribution" | "note"
> {
  if (progress.kind === "UNKNOWN") {
    // Empty cells, and the reason — an unknown value must never read as a zero.
    return { current: "", percent: "", remaining: "", contribution: "", note: progress.reason };
  }

  return {
    current: progress.current.toFixed(2),
    percent: progress.percentage.toFixed(1),
    remaining: progress.remaining.toFixed(2),
    contribution: progress.monthlyContribution?.toFixed(2) ?? "",
    note: progress.contributionNote ?? "",
  };
}

export async function GET(request: Request): Promise<Response> {
  const user = await requireApiUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status");
  const status = GOAL_STATUSES.find((value) => value === rawStatus);

  const goals = (await listGoals(user.id, { take: EXPORT_ROW_LIMIT })).filter(
    (goal) => status === undefined || goal.status === status,
  );

  // A linked goal reads the recorded balance of its account; an account with nothing
  // recorded yields `null` (unknown), which the progress turns into empty cells.
  const balances = new Map(
    await Promise.all(
      goals
        .filter((goal) => goal.accountId !== null)
        .map(async (goal) => {
          const { transactionCount, balance } = await readAccountBalance(
            user.id,
            goal.accountId as string,
          );
          return [goal.accountId as string, transactionCount === 0 ? null : balance] as const;
        }),
    ),
  );

  const rows: GoalRow[] = goals.map((goal) => {
    const progress = computeGoalProgress(
      goal,
      goal.accountId === null ? null : (balances.get(goal.accountId) ?? null),
    );

    return {
      name: goal.name,
      currency: goal.currency,
      targetAmount: goal.targetAmount.toFixed(2),
      targetDate: toDateOnlyString(goal.targetDate),
      status: goal.status,
      source: sourceLabel(goal),
      account: goal.accountName ?? "",
      ...numericCells(progress),
    };
  });

  return createCsvResponse(toCsv(rows, COLUMNS), "objectifs.csv");
}
