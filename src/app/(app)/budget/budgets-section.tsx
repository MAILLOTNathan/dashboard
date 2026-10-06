import Link from "next/link";
import {
  Card,
  EmptyState,
  Notice,
  TableShell,
  tdClass,
  thClass,
} from "@/components/ui";
import { formatMonthLabel, parseMonthKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { toBudgetFormInitialValues, type CategoryKind } from "@/modules/budget/domain";
import { findBudget, listBudgets, listCategories } from "@/modules/budget/repository";
import { BudgetForm } from "./budget-form";
import { DeleteBudgetButton } from "./delete-budget-button";

const CATEGORY_KIND_LABELS: Record<CategoryKind, string> = {
  INCOME: "Recette",
  EXPENSE: "Dépense",
};

/**
 * "Budgets" tab: the planned amounts of one month, per category and currency.
 *
 * The section reads its own data: no transaction, no chart window. The month picker
 * belongs to this tab because budgets are consulted month by month, like the operations.
 */
export async function BudgetsSection({
  userId,
  monthKey,
  editBudgetId,
}: {
  userId: string;
  /** `YYYY-MM`, the month shared by every tab. */
  monthKey: string;
  /** `?editBudget=`, an identifier to look up: a foreign one finds nothing. */
  editBudgetId?: string;
}) {
  const { year, month } = parseMonthKey(monthKey);

  const [categories, budgets, editBudgetTarget] = await Promise.all([
    listCategories(userId),
    // The budgets of the displayed month: the section never mixes months or currencies.
    listBudgets(userId, { year, month }),
    editBudgetId ? findBudget(userId, editBudgetId) : Promise.resolve(null),
  ]);

  // A stale or foreign identifier fills nothing and is reported, so the form never looks
  // like it silently lost the row.
  const budgetEditing = editBudgetTarget;
  const budgetEditTargetIsHidden = Boolean(editBudgetId) && editBudgetTarget === null;

  // Where "Annuler" returns to, month and tab preserved.
  const listHref = `/budget?month=${monthKey}&tab=budgets`;

  return (
    <Card
      title={`Budgets mensuels — ${formatMonthLabel(year, month)}`}
      description="Montants prévus par catégorie et par devise pour le mois affiché. Un budget est toujours positif ; les devises restent séparées et ne sont jamais converties."
    >
      <form method="get" action="/budget" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="budgets" />

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Mois affiché</span>
          <input
            type="month"
            name="month"
            defaultValue={monthKey}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Afficher
        </button>
      </form>

      {budgetEditTargetIsHidden ? (
        <Notice tone="warning">
          Le budget demandé n&apos;existe plus, ou ne fait pas partie de vos données : le
          formulaire reste en mode création.
        </Notice>
      ) : null}

      {budgetEditing ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">
            Modifier le budget « {budgetEditing.categoryName} —{" "}
            {formatMonthLabel(budgetEditing.year, budgetEditing.month)} (
            {budgetEditing.currency}) »
          </p>
          <BudgetForm
            key={budgetEditing.id}
            categories={categories}
            defaultMonth={monthKey}
            editing={toBudgetFormInitialValues(budgetEditing)}
            cancelHref={listHref}
          />
        </div>
      ) : (
        <details open>
          <summary className="cursor-pointer text-sm font-medium">Nouveau budget</summary>
          <div className="pt-3">
            <BudgetForm categories={categories} defaultMonth={monthKey} />
          </div>
        </details>
      )}

      <div className="mt-4">
        {budgets.length === 0 ? (
          <EmptyState
            title={`Aucun budget pour ${formatMonthLabel(year, month)}`}
            description="Ce n'est pas un montant prévu à zéro : aucune ligne n'existe pour ce mois. Un budget se définit ci-dessus, par catégorie et par devise."
          />
        ) : (
          <TableShell caption="Budgets du mois">
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Catégorie
                </th>
                <th scope="col" className={thClass}>
                  Nature
                </th>
                <th scope="col" className={thClass}>
                  Devise
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Montant prévu
                </th>
                <th scope="col" className={thClass}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {budgets.map((budget) => (
                <tr
                  key={budget.id}
                  className={
                    budgetEditing?.id === budget.id
                      ? "bg-amber-50 dark:bg-amber-950/30"
                      : undefined
                  }
                >
                  <td className={tdClass}>{budget.categoryName}</td>
                  <td className={tdClass}>{CATEGORY_KIND_LABELS[budget.categoryKind]}</td>
                  <td className={tdClass}>{budget.currency}</td>
                  <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                    {formatMoney({
                      amount: budget.amount,
                      currency: budget.currency,
                    })}
                  </td>
                  <td className={tdClass}>
                    <div className="flex flex-col items-start gap-1">
                      <Link
                        href={`${listHref}&editBudget=${budget.id}`}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        Modifier
                      </Link>
                      <DeleteBudgetButton
                        budgetId={budget.id}
                        label={`${budget.categoryName} — ${formatMonthLabel(
                          budget.year,
                          budget.month,
                        )} (${budget.currency})`}
                      />
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
