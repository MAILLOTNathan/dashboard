import { Decimal } from "@/generated/prisma/internal/prismaNamespace";
import {
  currentMonthKey,
  formatMonthLabel,
  monthRange,
  parseMonthKey,
} from "@/lib/dates";
import { describeAlert, type AlertKind, type AlertTone } from "@/modules/alerts/domain";
import { listAlerts } from "@/modules/alerts/repository";
import { buildBudgetReport, summariseBudgetReport, type BudgetReportTotal } from "@/modules/budget/report";
import {
  countTransactions,
  listAccounts,
  listBudgets,
  listTransactions,
  listTransactionsForSeries,
} from "@/modules/budget/repository";
import { computeCumulativeTotal, computeTotalsByCurrency, type MonthlyTotals } from "@/modules/budget/totals";
import {
  describeConnectionState,
  isSyncStale,
  type ConnectionState,
  type ConnectionSummary,
} from "@/modules/integrations/domain";
import { listConnections } from "@/modules/integrations/repository";
import { countProperties } from "@/modules/real-estate/repository";

/**
 * Dashboard queries.
 *
 * The dashboard only reads. It reports three distinct situations without ever
 * substituting one for another:
 * - "no data yet" (nothing has been entered),
 * - "no data this month" (the account exists but the month is empty),
 * - "not connected" / "synchronisation failed" for a provider.
 *
 * Budget tracking reuses the report builder of the budget module, so its figures equal
 * the ones on the budget page; a month without budget exposes an empty list, never a
 * total of zero.
 */

export type DashboardBudgetSummary = {
  accountCount: number;
  /** Total number of transactions, used to tell "empty account" from "empty month". */
  transactionCount: number;
  monthTransactionCount: number;
  monthTotals: MonthlyTotals[];
  totalCumulative: Decimal;
};

export type DashboardBudgetTracking = {
  /** One total per (currency, kind) of the month's budgets; empty when none is defined. */
  totals: BudgetReportTotal[];
  /** True when the month's transaction read hit its bound: the actuals may be understated. */
  truncated: boolean;
};

export type DashboardIntegrationSummary = {
  connection: ConnectionSummary;
  state: ConnectionState;
  /** True when the last successful synchronisation is older than the displayed threshold. */
  stale: boolean;
};

/** One open alert, as the dashboard banner shows it: explained, never forged. */
export type DashboardAlert = {
  id: string;
  kind: AlertKind;
  title: string;
  reason: string;
  tone: AlertTone;
  triggeredAt: Date;
};

export type DashboardOverview = {
  monthKey: string;
  monthLabel: string;
  budget: DashboardBudgetSummary;
  /** Planned versus actual totals of the month's budgets, the "Suivi" figures. */
  budgetTracking: DashboardBudgetTracking;
  realEstate: { propertyCount: number };
  integrations: DashboardIntegrationSummary[];
  /** Alerts currently open, read from the stored episodes (the page refreshes them). */
  alerts: { active: DashboardAlert[] };
};

export async function getDashboardOverview(
  userId: string,
  options: { now?: Date } = {},
): Promise<DashboardOverview> {
  const now = options.now ?? new Date();
  const monthKey = currentMonthKey(now);
  const { year, month } = parseMonthKey(monthKey);
  const range = monthRange(year, month);

  const [
    monthTransactions,
    transactionCount,
    propertyCount,
    connections,
    accounts,
    monthBudgets,
    monthSeries,
    alerts,
  ] = await Promise.all([
    listTransactions(userId, { from: range.start, to: range.end }),
    countTransactions(userId),
    countProperties(userId),
    listConnections(userId),
    listAccounts(userId),
    listBudgets(userId, { year, month }),
    // The same read as the 'Suivi' tab, so both screens compare the budgets to the same
    // transactions; reaching the bound is reported through `truncated`.
    listTransactionsForSeries(userId, { from: range.start, to: range.end }),
    // The stored episodes: the page runs the evaluation pass before this read, so the
    // banner shows what the engine just found, not what it found last time.
    listAlerts(userId),
  ]);

  const allTransactions = await listTransactions(userId);

  const budgetTotals = summariseBudgetReport(
    buildBudgetReport(monthBudgets, monthSeries.transactions),
  );

  return {
    monthKey,
    monthLabel: formatMonthLabel(year, month),
    budget: {
      accountCount: accounts.length,
      transactionCount,
      monthTransactionCount: monthTransactions.length,
      monthTotals: computeTotalsByCurrency(monthTransactions),
      totalCumulative: computeCumulativeTotal(allTransactions, { currency: "EUR" }),
    },
    budgetTracking: {
      totals: budgetTotals,
      truncated: monthSeries.truncated,
    },
    realEstate: { propertyCount },
    integrations: connections.map((connection) => ({
      connection,
      state: describeConnectionState({
        status: connection.status,
        lastSyncedAt: connection.lastSyncedAt,
        lastSyncError: connection.lastSyncError,
        projectCount: connection.projectCount,
      }),
      stale:
        connection.lastSyncedAt !== null && isSyncStale(connection.lastSyncedAt, now),
    })),
    alerts: {
      active: alerts
        .filter((alert) => alert.status === "ACTIVE")
        .map((alert) => ({
          id: alert.id,
          kind: alert.kind,
          triggeredAt: alert.triggeredAt,
          ...describeAlert({ kind: alert.kind, inputs: alert.inputs }),
        })),
    },
  };
}
