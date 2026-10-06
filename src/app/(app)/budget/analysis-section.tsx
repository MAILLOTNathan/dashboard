import Link from "next/link";
import { CategoryBars, MonthlyTrendChart, type TrendPoint } from "@/components/charts";
import { Card, Notice, StatCard } from "@/components/ui";
import {
  formatMonthLabel,
  formatShortMonthLabel,
  monthKeysEndingAt,
  monthRange,
  parseMonthKey,
} from "@/lib/dates";
import { publicEnv } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import type { TransactionType } from "@/modules/budget/domain";
import {
  listAccounts,
  listCategories,
  listTransactions,
  listTransactionsForSeries,
} from "@/modules/budget/repository";
import { buildCategoryBreakdown, buildMonthlySeries } from "@/modules/budget/series";
import {
  computeCumulativeTotal,
  computeTotalsByCurrency,
  groupTransactionsByCurrency,
} from "@/modules/budget/totals";
import { BudgetFilters, type BudgetFilterValues } from "./budget-filters";

/** Months shown on the trend chart: a year is the shortest period that shows a season. */
const TREND_MONTHS = 12;
/** Categories drawn on the breakdown before the tail is merged into "Autres". */
const BREAKDOWN_LIMIT = 8;

/**
 * "Analyse" tab: the month's indicators and the charts.
 *
 * The section reads its own data — including the chart window, which may hold thousands
 * of rows — so opening the operations tab never pays for it.
 */
export async function AnalysisSection({
  userId,
  monthKey,
  filters,
  breakdownKind,
}: {
  userId: string;
  /** `YYYY-MM`, the month shared by every tab. */
  monthKey: string;
  filters: BudgetFilterValues;
  /** Which side of the ledger the breakdown shows. */
  breakdownKind: TransactionType;
}) {
  const { year, month } = parseMonthKey(monthKey);
  const range = monthRange(year, month);

  // The charts read the same filters as the table, but over a year instead of one
  // month: a trend line built from a single month would say nothing.
  const trendMonthKeys = monthKeysEndingAt(monthKey, TREND_MONTHS);
  const trendStart = monthRange(
    Number(trendMonthKeys[0].slice(0, 4)),
    Number(trendMonthKeys[0].slice(5, 7)),
  ).start;

  const [accounts, categories, transactions, series] = await Promise.all([
    listAccounts(userId),
    listCategories(userId),
    listTransactions(userId, {
      from: range.start,
      to: range.end,
      ...filters,
    }),
    listTransactionsForSeries(userId, {
      from: trendStart,
      to: range.end,
      ...filters,
    }),
  ]);

  const totals = computeTotalsByCurrency(transactions);
  const seriesByCurrency = [...groupTransactionsByCurrency(series.transactions)];
  // A fresh owner has no transaction at all: the card still renders with the configured
  // default currency instead of crashing on an empty list, and the sum is only ever taken
  // over one currency (see `computeCumulativeTotal`).
  const cumulativeCurrency = totals[0]?.currency ?? publicEnv.NEXT_PUBLIC_DEFAULT_CURRENCY;
  const totalCumulative = computeCumulativeTotal(
    series.transactions.filter(
      (transaction) => transaction.currency === cumulativeCurrency,
    ),
    { currency: cumulativeCurrency },
  );

  return (
    <>
      <BudgetFilters
        tab="analysis"
        monthKey={monthKey}
        accounts={accounts}
        categories={categories}
        values={filters}
      />

      <StatCard
        label={`Solde cumulé (${cumulativeCurrency})`}
        value={formatMoney({
          amount: totalCumulative,
          currency: cumulativeCurrency,
        })}
        hint="Solde cumulé depuis le début de l'historique."
      />

      {totals.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {totals.map((monthly) => (
            <div key={monthly.currency} className="contents">
              <StatCard
                label={`Recettes (${monthly.currency})`}
                value={formatMoney({
                  amount: monthly.income,
                  currency: monthly.currency,
                })}
              />
              <StatCard
                label={`Dépenses (${monthly.currency})`}
                value={formatMoney({
                  amount: monthly.expenses,
                  currency: monthly.currency,
                })}
              />
              <StatCard
                label={`Solde mensuel (${monthly.currency})`}
                value={formatMoney({
                  amount: monthly.net,
                  currency: monthly.currency,
                })}
                tone={monthly.net.isNegative() ? "negative" : "positive"}
                hint="Transferts inclus."
              />
              <StatCard
                label={`Transferts (${monthly.currency})`}
                value={formatMoney({
                  amount: monthly.transfers,
                  currency: monthly.currency,
                })}
                hint="Déjà comptés en recettes ou en dépenses, selon le signe."
              />
            </div>
          ))}
        </div>
      ) : null}

      {seriesByCurrency.length === 0 ? (
        <Notice tone="info">
          Aucune opération sur les {TREND_MONTHS} derniers mois : les graphiques
          apparaîtront dès la première saisie. Un graphique vide n&apos;est pas un solde à
          zéro.
        </Notice>
      ) : (
        seriesByCurrency.map(([currency, currencyTransactions]) => {
          const windowStart = range.start;
          const points: TrendPoint[] = buildMonthlySeries(
            currencyTransactions,
            trendMonthKeys,
          ).map((point) => ({
            monthKey: point.monthKey,
            label: formatShortMonthLabel(point.year, point.month),
            income: point.totals.income,
            expenses: point.totals.expenses,
            net: point.totals.net,
          }));

          const breakdown = buildCategoryBreakdown(
            currencyTransactions.filter(
              (transaction) =>
                transaction.operationDate.getTime() >= windowStart.getTime() &&
                transaction.operationDate.getTime() < range.end.getTime(),
            ),
            { kind: breakdownKind, limit: BREAKDOWN_LIMIT },
          );

          const breakdownParams = new URLSearchParams({ month: monthKey, tab: "analysis" });
          if (filters.accountId) breakdownParams.set("account", filters.accountId);
          if (filters.categoryId) breakdownParams.set("category", filters.categoryId);
          if (filters.type) breakdownParams.set("type", filters.type);
          if (filters.search) breakdownParams.set("q", filters.search);
          breakdownParams.set(
            "breakdown",
            breakdownKind === "EXPENSE" ? "INCOME" : "EXPENSE",
          );

          return (
            <div key={currency} className="flex flex-col gap-4">
              <Card
                title={`Tendance sur ${TREND_MONTHS} mois — ${currency}`}
                description={`Recettes au-dessus de l'axe, dépenses en dessous, mois par mois jusqu'à ${formatMonthLabel(year, month)}. Les transferts entre comptes comptent selon leur signe, comme partout ailleurs.${
                  series.truncated
                    ? " Attention : le nombre d'opérations de la période dépasse la limite de lecture, les totaux affichés sont donc partiels."
                    : ""
                }`}
              >
                <MonthlyTrendChart points={points} currency={currency} />
              </Card>

              <Card
                title={`${breakdownKind === "EXPENSE" ? "Où part l'argent" : "D'où vient l'argent"} — ${formatMonthLabel(year, month)}`}
                description="Part de chaque catégorie sur le mois sélectionné, avec les mêmes filtres que le tableau. Une ligne « Sans catégorie » apparaît quand des opérations n'en ont pas, et une ligne « Transferts entre comptes » quand des transferts comptent de ce côté : les bars doivent tomber juste."
                actions={
                  <Link
                    href={`/budget?${breakdownParams.toString()}`}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Voir les {breakdownKind === "EXPENSE" ? "recettes" : "dépenses"}
                  </Link>
                }
              >
                <CategoryBars
                  entries={breakdown.entries}
                  currency={currency}
                  total={breakdown.total}
                />
              </Card>
            </div>
          );
        })
      )}
    </>
  );
}
