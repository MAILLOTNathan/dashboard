import {
  currentMonthKey,
  formatMonthLabel,
  monthRange,
  parseMonthKey,
} from "@/lib/dates";
import { countTransactions, listAccounts, listTransactions } from "@/modules/budget/repository";
import { computeTotalsByCurrency, type MonthlyTotals } from "@/modules/budget/totals";
import {
  describeConnectionState,
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
 */

export type DashboardBudgetSummary = {
  accountCount: number;
  /** Total number of transactions, used to tell "empty account" from "empty month". */
  transactionCount: number;
  monthTransactionCount: number;
  monthTotals: MonthlyTotals[];
};

export type DashboardIntegrationSummary = {
  connection: ConnectionSummary;
  state: ConnectionState;
};

export type DashboardOverview = {
  monthKey: string;
  monthLabel: string;
  budget: DashboardBudgetSummary;
  realEstate: { propertyCount: number };
  integrations: DashboardIntegrationSummary[];
};

export async function getDashboardOverview(
  userId: string,
  options: { now?: Date } = {},
): Promise<DashboardOverview> {
  const now = options.now ?? new Date();
  const monthKey = currentMonthKey(now);
  const { year, month } = parseMonthKey(monthKey);
  const range = monthRange(year, month);

  const [monthTransactions, transactionCount, propertyCount, connections, accounts] =
    await Promise.all([
      listTransactions(userId, { from: range.start, to: range.end }),
      countTransactions(userId),
      countProperties(userId),
      listConnections(userId),
      listAccounts(userId),
    ]);

  return {
    monthKey,
    monthLabel: formatMonthLabel(year, month),
    budget: {
      accountCount: accounts.length,
      transactionCount,
      monthTransactionCount: monthTransactions.length,
      monthTotals: computeTotalsByCurrency(monthTransactions),
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
    })),
  };
}
