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
import { formatMonthLabel, monthRange, parseMonthKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/modules/budget/domain";
import {
  buildBudgetReport,
  describeBudgetVariance,
  summariseBudgetReport,
  type BudgetVarianceTone,
} from "@/modules/budget/report";
import { listBudgets, listTransactionsForSeries } from "@/modules/budget/repository";

const CATEGORY_KIND_LABELS: Record<CategoryKind, string> = {
  INCOME: "Recette",
  EXPENSE: "Dépense",
};

const TOTAL_LABELS: Record<CategoryKind, string> = {
  INCOME: "Total recettes",
  EXPENSE: "Total dépenses",
};

/** Colours the remaining figure like the state badge it reads with. */
function remainingToneClass(tone: BudgetVarianceTone): string {
  return tone === "negative"
    ? "text-rose-700 dark:text-rose-400"
    : tone === "warning"
      ? "text-amber-700 dark:text-amber-300"
      : "";
}

/**
 * "Suivi" tab: planned versus actual for one month, per category and currency.
 *
 * The section reads its own data and hands it to the report module, which reuses the
 * documented aggregation rules (operation dates, sign of the amounts, refunds reducing
 * their category), so a figure here always equals the same figure elsewhere. Nothing is
 * converted: a row is a (category, currency) pair. Only budgeted categories appear —
 * "where did the money go" is the Analyse tab's question, not this one.
 */
export async function ReportSection({
  userId,
  monthKey,
}: {
  userId: string;
  /** `YYYY-MM`, the month shared by every tab. */
  monthKey: string;
}) {
  const { year, month } = parseMonthKey(monthKey);
  const range = monthRange(year, month);
  const monthLabel = formatMonthLabel(year, month);

  const [budgets, series] = await Promise.all([
    listBudgets(userId, { year, month }),
    // The whole month, capped like the chart window: reaching the cap is reported rather
    // than silently under-reporting the actual.
    listTransactionsForSeries(userId, { from: range.start, to: range.end }),
  ]);

  const rows = buildBudgetReport(budgets, series.transactions);
  const totals = summariseBudgetReport(rows);

  return (
    <Card
      title={`Suivi budgétaire — ${monthLabel}`}
      description="Prévu, réalisé et reste par catégorie et par devise. Le réalisé ne compte que les opérations datées du mois, rattachées à la catégorie et de la même devise : un remboursement réduit une dépense, les transferts — sans catégorie — n'apparaissent pas, et aucune devise n'est convertie. Les totaux du bas additionnent les lignes d'une même devise et d'une même nature : une enveloppe de dépenses et un objectif de recettes ne sont jamais mélangés."
      actions={
        <Link
          href={`/budget?month=${monthKey}&tab=budgets`}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Ajuster les budgets
        </Link>
      }
    >
      <form method="get" action="/budget" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="report" />

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

      {budgets.length === 0 ? (
        <EmptyState
          title={`Aucun budget pour ${monthLabel}`}
          description="Ce n'est pas un suivi à zéro : aucune ligne de budget n'existe pour ce mois. Définissez-les dans l'onglet Budgets pour voir ici le prévu, le réalisé et le reste."
          action={
            <Link
              href={`/budget?month=${monthKey}&tab=budgets`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Définir les budgets
            </Link>
          }
        />
      ) : (
        <>
          {series.transactions.length === 0 ? (
            <div className="mb-4">
              <Notice tone="info">
                Aucune opération datée de {monthLabel} : le réalisé est à zéro pour toutes
                les lignes, et les budgets restent affichés.
              </Notice>
            </div>
          ) : null}

          {series.truncated ? (
            <div className="mb-4">
              <Notice tone="warning">
                Le mois dépasse la limite de lecture : le réalisé affiché est partiel et
                les écarts peuvent être sous-estimés.
              </Notice>
            </div>
          ) : null}

          <TableShell caption="Suivi du budget">
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
                  Prévu
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Réalisé
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Reste
                </th>
                <th scope="col" className={thClass}>
                  État
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const variance = describeBudgetVariance(row);
                const remainingClass = remainingToneClass(variance.tone);

                return (
                  <tr key={row.key}>
                    <td className={tdClass}>{row.categoryName}</td>
                    <td className={tdClass}>{CATEGORY_KIND_LABELS[row.categoryKind]}</td>
                    <td className={tdClass}>{row.currency}</td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {formatMoney({ amount: row.planned, currency: row.currency })}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {formatMoney({ amount: row.actual, currency: row.currency })}
                    </td>
                    <td
                      className={`${tdClass} whitespace-nowrap text-right tabular-nums ${remainingClass}`}
                    >
                      {formatMoney({ amount: row.remaining, currency: row.currency })}
                    </td>
                    <td className={tdClass}>
                      <Badge tone={variance.tone}>{variance.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {totals.length > 0 ? (
              <tfoot>
                {totals.map((total) => {
                  const variance = describeBudgetVariance(total);

                  return (
                    <tr
                      key={`${total.currency}|${total.categoryKind}`}
                      className="border-t-2 border-zinc-200 dark:border-zinc-700"
                    >
                      <td colSpan={3} className={`${tdClass} font-medium`}>
                        {TOTAL_LABELS[total.categoryKind]} ({total.currency})
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                        {formatMoney({ amount: total.planned, currency: total.currency })}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                        {formatMoney({ amount: total.actual, currency: total.currency })}
                      </td>
                      <td
                        className={`${tdClass} whitespace-nowrap text-right tabular-nums ${remainingToneClass(variance.tone)}`}
                      >
                        {formatMoney({ amount: total.remaining, currency: total.currency })}
                      </td>
                      <td className={tdClass}>
                        <Badge tone={variance.tone}>{variance.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tfoot>
            ) : null}
          </TableShell>
        </>
      )}
    </Card>
  );
}
