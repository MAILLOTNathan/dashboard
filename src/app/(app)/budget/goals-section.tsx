import Link from "next/link";
import {
  Badge,
  Card,
  EmptyState,
  Notice,
  TableShell,
  tdClass,
  thClass,
} from "@/components/ui";
import { formatDateOnly } from "@/lib/dates";
import { formatMoney, type Currency } from "@/lib/money";
import {
  GOAL_STATUS_LABELS,
  computeGoalProgress,
  toGoalFormInitialValues,
  type GoalProgress,
  type GoalRecord,
  type GoalStatus,
} from "@/modules/budget/goals";
import {
  findGoal,
  listAccounts,
  listGoals,
  readAccountBalance,
} from "@/modules/budget/repository";
import { DeleteGoalButton } from "./delete-goal-button";
import { GoalForm } from "./goal-form";

const STATUS_TONES: Record<GoalStatus, "neutral" | "positive" | "warning"> = {
  ACTIVE: "neutral",
  ACHIEVED: "positive",
  ABANDONED: "warning",
};

/** "30,0" — never "30.0": the interface is French, the stored value is a plain Decimal. */
const PERCENT_FORMAT = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** An unknown value reads as "—", never as 0,00 €. */
function UnknownCell() {
  return <span title="Donnée inconnue">—</span>;
}

/** Amount and percentage, side by side, with a bar that caps at 100 %. */
function ProgressCell({ goal, progress }: { goal: GoalRecord; progress: GoalProgress }) {
  if (progress.kind === "UNKNOWN") {
    return (
      <span className="text-xs text-amber-700 dark:text-amber-400">{progress.reason}</span>
    );
  }

  const width = Math.min(100, Math.max(0, progress.percentage.toNumber()));

  return (
    <div className="flex min-w-44 flex-col gap-1">
      <span className="tabular-nums">
        {formatMoney({ amount: progress.current, currency: goal.currency })}{" "}
        <span className="text-zinc-500 dark:text-zinc-400">
          / {formatMoney({ amount: goal.targetAmount, currency: goal.currency })}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <span
          className="block h-1.5 w-24 rounded-full bg-zinc-200 dark:bg-zinc-800"
          aria-hidden="true"
        >
          <span
            className={`block h-1.5 rounded-full ${
              progress.reached ? "bg-emerald-600" : "bg-zinc-900 dark:bg-zinc-100"
            }`}
            style={{ width: `${width}%` }}
          />
        </span>
        <span className="text-xs tabular-nums">
          {PERCENT_FORMAT.format(progress.percentage.toNumber())} %
        </span>
      </span>
    </div>
  );
}

/** What the deadline demands: the figure, its horizon, or the reason there is none. */
function ContributionCell({ progress, currency }: { progress: GoalProgress; currency: Currency }) {
  if (progress.kind === "UNKNOWN") {
    return <UnknownCell />;
  }

  if (progress.monthlyContribution === null) {
    return (
      <span className="text-xs text-zinc-600 dark:text-zinc-400">{progress.contributionNote}</span>
    );
  }

  return (
    <span className="flex flex-col">
      <span className="whitespace-nowrap tabular-nums">
        {formatMoney({ amount: progress.monthlyContribution, currency })}
      </span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        {progress.monthsLeft === 1 ? "sur 1 mois restant" : `sur ${progress.monthsLeft} mois restants`}
      </span>
    </span>
  );
}

/**
 * "Objectifs" tab: savings or repayment goals, their progress and what the deadline asks.
 *
 * The section reads its own data and documents its rules in place: a goal's current
 * amount comes from a manual amount or from the recorded balance of a linked account
 * (the signed sum of its transactions). When neither is available, the progress shows
 * the reason instead of a zero — "nothing recorded" is not "nothing saved". The monthly
 * contribution is the remaining amount divided by the whole calendar months left,
 * rounded half-up on cents (documented in `docs/architecture/overview.md`), and it is
 * not defined once the deadline has passed or the goal is reached.
 */
export async function GoalsSection({
  userId,
  editGoalId,
}: {
  userId: string;
  /** `?editGoal=`, an identifier to look up: a foreign one finds nothing. */
  editGoalId?: string;
}) {
  const [goals, accounts, editTarget] = await Promise.all([
    listGoals(userId),
    listAccounts(userId),
    editGoalId ? findGoal(userId, editGoalId) : Promise.resolve(null),
  ]);

  // A stale or foreign identifier fills nothing and is reported, so the form never looks
  // like it silently lost the row.
  const goalEditing = editTarget;
  const goalEditTargetIsHidden = Boolean(editGoalId) && editTarget === null;

  // One aggregate per linked goal: an account with no recorded transaction yields `null`
  // — the unknown balance — while an account whose movements net to zero yields a real
  // 0,00 €, and the two must not be confused.
  const balances = await Promise.all(
    goals.map((goal) =>
      goal.accountId
        ? readAccountBalance(userId, goal.accountId).then(({ transactionCount, balance }) =>
            transactionCount === 0 ? null : balance,
          )
        : Promise.resolve(null),
    ),
  );

  const rows = goals.map((goal, index) => ({
    goal,
    progress: computeGoalProgress(goal, balances[index] ?? null),
  }));

  const listHref = "/budget?tab=goals";

  return (
    <Card
      title="Objectifs"
      description="Un objectif est un montant cible dans une devise, à atteindre avant une échéance. Sa progression vient d'un montant saisi à la main ou du solde enregistré d'un compte lié — jamais des deux. Sans source, ou sans opération sur le compte lié, la progression est affichée comme inconnue, pas comme zéro. La contribution mensuelle est le reste divisé par les mois entiers restants, arrondie au centime (au demi supérieur) ; elle n'est plus définie après l'échéance ni une fois l'objectif atteint. Aucune conversion entre devises."
    >
      {goalEditTargetIsHidden ? (
        <Notice tone="warning">
          L&apos;objectif demandé n&apos;existe plus, ou ne fait pas partie de vos données : le
          formulaire reste en mode création.
        </Notice>
      ) : null}

      {goalEditing ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm font-medium">Modifier l&apos;objectif « {goalEditing.name} »</p>
          <GoalForm
            key={goalEditing.id}
            accounts={accounts}
            editing={toGoalFormInitialValues(goalEditing)}
            cancelHref={listHref}
          />
        </div>
      ) : (
        <details open>
          <summary className="cursor-pointer text-sm font-medium">Nouvel objectif</summary>
          <div className="pt-3">
            <GoalForm accounts={accounts} />
          </div>
        </details>
      )}

      <div className="mt-4">
        {goals.length === 0 ? (
          <EmptyState
            title="Aucun objectif"
            description="Ce n'est pas un objectif à zéro : aucune ligne n'existe encore. Un objectif se définit ci-dessus, avec un montant cible et une échéance."
          />
        ) : (
          <TableShell caption="Objectifs et progression">
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Objectif
                </th>
                <th scope="col" className={thClass}>
                  Statut
                </th>
                <th scope="col" className={thClass}>
                  Progression
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Reste
                </th>
                <th scope="col" className={thClass}>
                  Contribution mensuelle
                </th>
                <th scope="col" className={thClass}>
                  Échéance
                </th>
                <th scope="col" className={thClass}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ goal, progress }) => (
                <tr
                  key={goal.id}
                  className={
                    goalEditing?.id === goal.id ? "bg-amber-50 dark:bg-amber-950/30" : undefined
                  }
                >
                  <td className={tdClass}>
                    <span className="flex flex-col">
                      <span className="font-medium">{goal.name}</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {goal.accountName
                          ? `Compte lié : ${goal.accountName} (${goal.currency})`
                          : goal.currentAmount === null
                            ? `Devise ${goal.currency} · aucune source : progression inconnue`
                            : `Montant saisi à la main (${goal.currency})`}
                      </span>
                    </span>
                  </td>
                  <td className={tdClass}>
                    <Badge tone={STATUS_TONES[goal.status]}>
                      {GOAL_STATUS_LABELS[goal.status]}
                    </Badge>
                  </td>
                  <td className={tdClass}>
                    <ProgressCell goal={goal} progress={progress} />
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                    {progress.kind === "KNOWN" ? (
                      formatMoney({ amount: progress.remaining, currency: goal.currency })
                    ) : (
                      <UnknownCell />
                    )}
                  </td>
                  <td className={tdClass}>
                    <ContributionCell progress={progress} currency={goal.currency} />
                  </td>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {formatDateOnly(goal.targetDate)}
                  </td>
                  <td className={tdClass}>
                    <div className="flex flex-col items-start gap-1">
                      <Link
                        href={`${listHref}&editGoal=${goal.id}`}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        Modifier
                      </Link>
                      <DeleteGoalButton goalId={goal.id} label={goal.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </div>
    </Card>
  );
}
