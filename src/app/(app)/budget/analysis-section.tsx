import Decimal from "decimal.js";
import Link from "next/link";
import { CategoryBars, MonthlyTrendChart, type TrendPoint } from "@/components/charts";
import { Card, Notice, StatCard, TableShell, tdClass, thClass } from "@/components/ui";
import {
  formatMonthLabel,
  formatShortMonthLabel,
  monthKeysEndingAt,
  monthRange,
  parseMonthKey,
  shiftMonthKey,
} from "@/lib/dates";
import { publicEnv } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import type { TransactionRecord, TransactionType } from "@/modules/budget/domain";
import {
  listAccounts,
  listCategories,
  listTransactionsForSeries,
  sumTransactionsByCurrency,
} from "@/modules/budget/repository";
import { buildCategoryBreakdown, buildMonthlySeries } from "@/modules/budget/series";
import { buildComparison } from "@/modules/budget/comparison";
import {
  computeTotalsByCurrency,
  groupTransactionsByCurrency,
} from "@/modules/budget/totals";
import { BudgetFilters, type BudgetFilterValues } from "./budget-filters";

/** Months shown on the trend chart: a year is the shortest period that shows a season. */
const TREND_MONTHS = 12;
/** Categories drawn on the breakdown before the tail is merged into "Autres". */
const BREAKDOWN_LIMIT = 8;

/** "+17,6 %" — display only; an undefined percentage reads as "—". */
const PERCENT_FORMAT = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

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
  const monthLabel = formatMonthLabel(year, month);

  // The charts read the same filters as the table, but over a year instead of one
  // month: a trend line built from a single month would say nothing.
  const trendMonthKeys = monthKeysEndingAt(monthKey, TREND_MONTHS);
  const trendStart = monthRange(
    Number(trendMonthKeys[0].slice(0, 4)),
    Number(trendMonthKeys[0].slice(5, 7)),
  ).start;

  // The two comparison periods: the month before, and the same month a year earlier.
  const previousParsed = parseMonthKey(shiftMonthKey(monthKey, -1));
  const lastYearParsed = parseMonthKey(shiftMonthKey(monthKey, -12));
  const previousRange = monthRange(previousParsed.year, previousParsed.month);
  const lastYearRange = monthRange(lastYearParsed.year, lastYearParsed.month);

  const [accounts, categories, series, cumulativeTotals, previousRead, lastYearRead] =
    await Promise.all([
      listAccounts(userId),
      listCategories(userId),
      listTransactionsForSeries(userId, {
        from: trendStart,
        to: range.end,
        ...filters,
      }),
      // The all-time signed total, aggregated in the database: reading the rows to add
      // them up would stop at the read bound and call the page "history".
      sumTransactionsByCurrency(userId),
      listTransactionsForSeries(userId, {
        from: previousRange.start,
        to: previousRange.end,
        ...filters,
      }),
      listTransactionsForSeries(userId, {
        from: lastYearRange.start,
        to: lastYearRange.end,
        ...filters,
      }),
    ]);

  // The month's own rows come from the series read (already bounded and truncation-flagged)
  // rather than a second, page-sized read of the same month: the totals above and the
  // comparison below can then never disagree about what the month holds.
  const currentMonthTransactions = series.transactions.filter(
    (transaction) =>
      transaction.operationDate.getTime() >= range.start.getTime() &&
      transaction.operationDate.getTime() < range.end.getTime(),
  );
  const totals = computeTotalsByCurrency(currentMonthTransactions);
  const seriesByCurrency = [...groupTransactionsByCurrency(series.transactions)];
  // A fresh owner has no transaction at all: the card still renders with the configured
  // default currency, and an empty aggregate is a real zero — nothing was recorded.
  const cumulativeCurrency = totals[0]?.currency ?? publicEnv.NEXT_PUBLIC_DEFAULT_CURRENCY;
  const totalCumulative = cumulativeTotals.get(cumulativeCurrency) ?? new Decimal(0);

  // The comparison stays hidden rather than partial when any of the three reads hit its
  // bound: a truncated side would read as a smaller month, not as an unknown one.
  const comparisonTruncated = series.truncated || previousRead.truncated || lastYearRead.truncated;
  const comparisonRows = comparisonTruncated
    ? []
    : buildComparison({
        current: currentMonthTransactions,
        previous: previousRead.transactions,
        sameMonthLastYear: lastYearRead.transactions,
      });

  // Per-category comparison of the displayed side of the ledger. A category absent from a
  // period that was read completely is a real zero for that period: the month was fully
  // read, so "no row" is "nothing spent", not "unknown".
  const comparisonCategories = comparisonRows.map((row) => {
    const breakdownFor = (transactions: readonly TransactionRecord[]) =>
      buildCategoryBreakdown(
        transactions.filter((transaction) => transaction.currency === row.currency),
        { kind: breakdownKind },
      );

    const currentBreak = breakdownFor(currentMonthTransactions);
    const previousBreak = breakdownFor(previousRead.transactions);
    const lastYearBreak = breakdownFor(lastYearRead.transactions);
    const keys = new Set(
      [...currentBreak.entries, ...previousBreak.entries, ...lastYearBreak.entries].map(
        (entry) => entry.key,
      ),
    );
    const amountOf = (
      breakdown: ReturnType<typeof buildCategoryBreakdown>,
      key: string,
    ) => breakdown.entries.find((entry) => entry.key === key)?.amount ?? new Decimal(0);

    const entries = [...keys]
      .map((key) => {
        const label =
          currentBreak.entries.find((entry) => entry.key === key)?.label ??
          previousBreak.entries.find((entry) => entry.key === key)?.label ??
          lastYearBreak.entries.find((entry) => entry.key === key)?.label ??
          key;

        return {
          key,
          label,
          current: amountOf(currentBreak, key),
          previous: amountOf(previousBreak, key),
          lastYear: amountOf(lastYearBreak, key),
        };
      })
      .sort(
        (left, right) =>
          right.current.abs().comparedTo(left.current.abs()) ||
          right.previous.abs().comparedTo(left.previous.abs()),
      );

    return { currency: row.currency, entries };
  });

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

      <Card
        title="Comparaison des périodes"
        description={`${monthLabel} face au mois précédent (${formatMonthLabel(previousParsed.year, previousParsed.month)}) et au même mois un an plus tôt (${formatMonthLabel(lastYearParsed.year, lastYearParsed.month)}). « — » signale un mois sans aucune donnée ; l'écart de solde est signé, et son pourcentage n'existe qu'au-dessus d'une base non nulle. Aucune devise n'est convertie.`}
      >
        {comparisonTruncated ? (
          <Notice tone="warning">
            Une des périodes comparées a atteint la limite de lecture : la comparaison est
            masquée plutôt que montrée partielle — un mois tronqué se lirait comme un mois
            plus calme.
          </Notice>
        ) : comparisonRows.length === 0 ? (
          <Notice tone="info">
            Aucune opération en {monthLabel} pour les filtres affichés : il n&apos;y a rien
            à comparer, ce qui n&apos;est pas un mois à zéro.
          </Notice>
        ) : (
          <div className="flex flex-col gap-5">
            {comparisonRows.map((row, index) => {
              const categoryEntries = comparisonCategories[index]?.entries ?? [];
              const money = (amount: Decimal) =>
                formatMoney({ amount, currency: row.currency });

              return (
                <div key={row.currency} className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">{row.currency}</h3>

                  <TableShell caption={`Comparaison des totaux — ${row.currency}`}>
                    <thead>
                      <tr>
                        <th scope="col" className={thClass}>
                          Indicateur
                        </th>
                        <th scope="col" className={`${thClass} text-right`}>
                          {monthLabel}
                        </th>
                        <th scope="col" className={`${thClass} text-right`}>
                          Mois précédent
                        </th>
                        <th scope="col" className={`${thClass} text-right`}>
                          Même mois l&apos;an dernier
                        </th>
                        <th scope="col" className={`${thClass} text-right`}>
                          Écart de solde
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className={tdClass}>Recettes</td>
                        <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                          {money(row.current.income)}
                        </td>
                        <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                          {row.previous === null ? "—" : money(row.previous.income)}
                        </td>
                        <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                          {row.sameMonthLastYear === null ? "—" : money(row.sameMonthLastYear.income)}
                        </td>
                        <td className={`${tdClass} text-right text-zinc-500 dark:text-zinc-400`}>—</td>
                      </tr>
                      <tr>
                        <td className={tdClass}>Dépenses</td>
                        <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                          {money(row.current.expenses)}
                        </td>
                        <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                          {row.previous === null ? "—" : money(row.previous.expenses)}
                        </td>
                        <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                          {row.sameMonthLastYear === null ? "—" : money(row.sameMonthLastYear.expenses)}
                        </td>
                        <td className={`${tdClass} text-right text-zinc-500 dark:text-zinc-400`}>—</td>
                      </tr>
                      <tr>
                        <td className={`${tdClass} font-medium`}>Solde</td>
                        <td className={`${tdClass} whitespace-nowrap text-right font-medium tabular-nums`}>
                          {money(row.current.net)}
                        </td>
                        <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                          {row.previous === null ? "—" : money(row.previous.net)}
                        </td>
                        <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                          {row.sameMonthLastYear === null ? "—" : money(row.sameMonthLastYear.net)}
                        </td>
                        <td
                          className={`${tdClass} whitespace-nowrap text-right tabular-nums ${
                            row.netDelta === null
                              ? ""
                              : row.netDelta.greaterThan(0)
                                ? "text-emerald-700 dark:text-emerald-400"
                                : row.netDelta.lessThan(0)
                                  ? "text-rose-700 dark:text-rose-400"
                                  : ""
                          }`}
                        >
                          {row.netDelta === null
                            ? "—"
                            : `${money(row.netDelta)}${
                                row.netPercent === null
                                  ? ""
                                  : ` (${PERCENT_FORMAT.format(row.netPercent.toNumber())} %)`
                              }`}
                        </td>
                      </tr>
                    </tbody>
                  </TableShell>

                  {categoryEntries.length > 0 ? (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-xs text-zinc-600 dark:text-zinc-400">
                        Détail par catégorie —{" "}
                        {breakdownKind === "EXPENSE" ? "dépenses" : "recettes"}
                      </summary>
                      <div className="pt-2">
                        <TableShell
                          caption={`Comparaison par catégorie — ${row.currency}`}
                        >
                          <thead>
                            <tr>
                              <th scope="col" className={thClass}>
                                Catégorie
                              </th>
                              <th scope="col" className={`${thClass} text-right`}>
                                {monthLabel}
                              </th>
                              <th scope="col" className={`${thClass} text-right`}>
                                Mois précédent
                              </th>
                              <th scope="col" className={`${thClass} text-right`}>
                                Même mois l&apos;an dernier
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {categoryEntries.map((entry) => (
                              <tr key={entry.key}>
                                <td className={tdClass}>{entry.label}</td>
                                <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                                  {money(entry.current)}
                                </td>
                                <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                                  {money(entry.previous)}
                                </td>
                                <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                                  {money(entry.lastYear)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </TableShell>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Une catégorie absente d&apos;un mois entièrement lu vaut zéro pour
                          ce mois — pas une donnée inconnue.
                        </p>
                      </div>
                    </details>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>

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
