import type { ReactNode } from "react";
import Decimal from "decimal.js";
import { formatShortMonthLabel } from "@/lib/dates";
import { formatCompactAmount, formatMoney, type Currency } from "@/lib/money";

/**
 * Charts, rendered as plain markup on the server.
 *
 * Two deliberate choices:
 *
 * - **No charting dependency.** These are bars, drawn once, server-rendered: no
 *   client bundle, no hydration, and the values stay readable and testable. A
 *   library would be justified by interaction or by every chart type, not by this.
 * - **Never a chart alone.** The exact figures are always printed next to the
 *   drawing, so a chart that fails to load, or a reader who cannot use one, loses
 *   nothing. `AGENTS.md` prefers a usable table to a decorative chart, and that is
 *   the standard these aim for: each one answers a question the table cannot.
 *
 * Decimal values are converted to numbers for geometry only. No number here is ever
 * fed back into a calculation: totals are computed on `Decimal` upstream.
 */

export type TrendPoint = {
  monthKey: string;
  label: string;
  income: Decimal;
  expenses: Decimal;
  net: Decimal;
};

const INCOME_COLOUR = "#10b981";
const EXPENSE_COLOUR = "#f43f5e";
/** Reserved band above the columns, where the monthly net is printed. */
const NET_LABEL_Y = 14;

export function MonthlyTrendChart({
  points,
  currency,
}: {
  points: TrendPoint[];
  currency: Currency;
}) {
  const width = 760;
  const height = 220;
  const axisY = height / 2;
  const halfHeight = axisY - 26;
  const columnWidth = width / Math.max(1, points.length);
  const barWidth = Math.min(22, columnWidth / 3);

  // One scale for both directions, so a bar of equal height means an equal amount.
  const peak = points.reduce((max, point) => {
    const highest = Decimal.max(point.income, point.expenses);
    return highest.greaterThan(max) ? highest : max;
  }, new Decimal(0));

  const scale = peak.isZero() ? null : peak;
  const barHeight = (value: Decimal): number => {
    if (!scale || value.isNegative() || value.isZero()) {
      return 0;
    }

    return value.dividedBy(scale).toNumber() * halfHeight;
  };

  const totalIncome = points.reduce((sum, point) => sum.plus(point.income), new Decimal(0));
  const totalExpenses = points.reduce((sum, point) => sum.plus(point.expenses), new Decimal(0));
  const totalNet = totalIncome.minus(totalExpenses);

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full"
        role="img"
        aria-label={`Recettes et dépenses par mois, de ${points[0]?.label ?? ""} à ${
          points[points.length - 1]?.label ?? ""
        }. Les transferts entre comptes sont exclus.`}
      >
        {/* Gridlines: the axis itself, then the peak on each side. */}
        <line
          x1={0}
          x2={width}
          y1={axisY}
          y2={axisY}
          stroke="currentColor"
          strokeWidth={1}
          className="text-zinc-300 dark:text-zinc-700"
        />

        {scale ? (
          <>
            <GridLine y={axisY - halfHeight} label={formatCompactAmount({ amount: scale, currency })} />
            <GridLine y={axisY + halfHeight} label={formatCompactAmount({ amount: scale, currency })} />
          </>
        ) : null}

        {points.map((point, index) => {
          const centre = index * columnWidth + columnWidth / 2;
          const incomeHeight = barHeight(point.income);
          const expenseHeight = barHeight(point.expenses);

          return (
            <g key={point.monthKey}>
              {incomeHeight > 0 ? (
                <rect
                  x={centre - barWidth - 1}
                  y={axisY - incomeHeight}
                  width={barWidth}
                  height={incomeHeight}
                  fill={INCOME_COLOUR}
                  rx={2}
                >
                  <title>{`${point.label} — recettes ${formatMoney({ amount: point.income, currency })}`}</title>
                </rect>
              ) : null}

              {expenseHeight > 0 ? (
                <rect
                  x={centre + 1}
                  y={axisY}
                  width={barWidth}
                  height={expenseHeight}
                  fill={EXPENSE_COLOUR}
                  rx={2}
                >
                  <title>{`${point.label} — dépenses ${formatMoney({ amount: point.expenses, currency })}`}</title>
                </rect>
              ) : null}

              <text
                x={centre}
                y={height - 6}
                textAnchor="middle"
                className="fill-zinc-500 text-[11px] dark:fill-zinc-400"
              >
                {periodLabel(point)}
              </text>

              {!point.net.isZero() ? (
                // A reserved band above the bars: the peak bar reaches `axisY - halfHeight`,
                // so this line never lands on top of a column.
                <text
                  x={centre}
                  y={NET_LABEL_Y}
                  textAnchor="middle"
                  className="fill-zinc-400 text-[10px] dark:fill-zinc-500"
                >
                  {formatCompactAmount({ amount: point.net, currency })}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      <ChartLegend>
        <LegendSwatch colour={INCOME_COLOUR} label="Recettes" />
        <LegendSwatch colour={EXPENSE_COLOUR} label="Dépenses" />
        <span className="text-zinc-500 dark:text-zinc-400">
          Le solde du mois est indiqué au-dessus de chaque colonne.
        </span>
      </ChartLegend>

      <p className="text-sm">
        Sur la période : recettes {formatMoney({ amount: totalIncome, currency })} · dépenses{" "}
        {formatMoney({ amount: totalExpenses, currency })} · solde{" "}
        <span
          className={
            totalNet.isNegative() ? "font-semibold text-rose-700 dark:text-rose-400" : "font-semibold"
          }
        >
          {formatMoney({ amount: totalNet, currency })}
        </span>
      </p>
    </div>
  );
}

export function CategoryBars({
  entries,
  currency,
  total,
}: {
  entries: { key: string; label: string; amount: Decimal; share: number }[];
  currency: Currency;
  total: Decimal;
}) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Aucune opération de ce type sur ce mois : il n&apos;y a rien à répartir.
      </p>
    );
  }

  // Bars are scaled on the largest positive amount; a category whose refunds exceed
  // its expenses would otherwise draw a meaningless negative width.
  const largest = entries.reduce(
    (max, entry) => (entry.amount.greaterThan(max) ? entry.amount : max),
    new Decimal(0),
  );
  const scale = largest.isZero() ? null : largest;

  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry) => {
        const ratio = scale && entry.amount.isPositive() ? entry.amount.dividedBy(scale).toNumber() : 0;

        return (
          <div key={entry.key} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{entry.label}</span>
              <span className="tabular-nums">
                {formatMoney({ amount: entry.amount, currency })}
                <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {formatShare(entry.share)}
                </span>
              </span>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
              role="presentation"
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(ratio * 100, entry.amount.isZero() ? 0 : 1.5)}%`,
                  backgroundColor: entry.amount.isNegative() ? INCOME_COLOUR : EXPENSE_COLOUR,
                }}
              />
            </div>
          </div>
        );
      })}

      <p className="text-sm">
        Total {formatMoney({ amount: total, currency })} — la somme des lignes ci-dessus, y compris
        les éventuels remboursements.
      </p>
    </div>
  );
}

/** Months are labelled "oct. 25", short enough to fit twelve of them. */
function periodLabel(point: TrendPoint): string {
  return formatShortMonthLabel(Number(point.monthKey.slice(0, 4)), Number(point.monthKey.slice(5, 7)));
}

function GridLine({ y, label }: { y: number; label: string }) {
  return (
    <g>
      <line
        x1={0}
        x2={760}
        y1={y}
        y2={y}
        stroke="currentColor"
        strokeWidth={1}
        strokeDasharray="3 4"
        className="text-zinc-200 dark:text-zinc-800"
      />
      <text x={2} y={y - 3} className="fill-zinc-400 text-[10px] dark:fill-zinc-500">
        {label}
      </text>
    </g>
  );
}

function ChartLegend({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
      {children}
    </div>
  );
}

function LegendSwatch({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{ backgroundColor: colour }}
      />
      {label}
    </span>
  );
}

/** Percentage of a total, floored so a rounded 100 % never overstates a share. */
function formatShare(share: number): string {
  if (!Number.isFinite(share)) {
    return "";
  }

  return `${(Math.round(share * 1000) / 10).toLocaleString("fr-FR", {
    maximumFractionDigits: 1,
  })} %`;
}
