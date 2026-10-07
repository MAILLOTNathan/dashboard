import Decimal from "decimal.js";
import { currentMonthKey, monthRange, parseMonthKey } from "@/lib/dates";
import {
  evaluateBudgetOverrun,
  evaluateLowBalance,
  evaluateUnusualExpense,
} from "@/modules/budget/alerts";
import { buildBudgetReport } from "@/modules/budget/report";
import {
  listAccountBalanceTotals,
  listAccounts,
  listBudgets,
  listTransactionsForSeries,
} from "@/modules/budget/repository";
import { evaluateStaleIntegration } from "@/modules/integrations/alerts";
import { listConnections } from "@/modules/integrations/repository";
import { evaluateOverdueEvent } from "@/modules/real-estate/alerts";
import { listDueCashflows } from "@/modules/real-estate/repository";
import { planAlertChanges } from "./lifecycle";
import { applyAlertPlan, listAlerts, listAlertRules } from "./repository";
import { resolveAlertRules, type AlertKind } from "./domain";

/**
 * One evaluation pass of the alert engine (BP-05), run server-side on demand.
 *
 * Pages that warn the owner call this while rendering (the same on-demand pattern the
 * Prévisions tab uses to materialise a month): the conditions are read now, compared to
 * the stored episodes, and the differences are written — never the other way around.
 * No rule touches the ledger: an alert is an observation, and dismissing one only
 * silences the warning.
 *
 * The pass is bounded: accounts with their grouped balances, the month's budgets and
 * transactions, the connections, the due cashflows, the stored episodes. A read that
 * could be partial (the month series hitting its row bound) makes the depending rules
 * stay quiet rather than accuse on half-read data.
 */

export type AlertRefreshSummary = {
  created: number;
  refreshed: number;
  reopened: number;
  resolved: number;
  /** Episodes open after the pass. */
  active: number;
};

export async function refreshAlerts(
  userId: string,
  options: { now?: Date } = {},
): Promise<AlertRefreshSummary> {
  const now = options.now ?? new Date();
  const monthKey = currentMonthKey(now);
  const { year, month } = parseMonthKey(monthKey);
  const range = monthRange(year, month);

  const [ruleRows, accounts, balanceTotals, budgets, monthSeries, connections, dueCashflows, existing] =
    await Promise.all([
      listAlertRules(userId),
      listAccounts(userId),
      listAccountBalanceTotals(userId),
      listBudgets(userId, { year, month }),
      listTransactionsForSeries(userId, { from: range.start, to: range.end }),
      listConnections(userId),
      listDueCashflows(userId, { until: now }),
      listAlerts(userId),
    ]);

  const rules = resolveAlertRules(ruleRows);
  const ruleFor = (kind: AlertKind) => rules.find((rule) => rule.kind === kind)!;

  // An account absent from the grouped read has nothing recorded: its balance stays
  // unknown (count 0) and the low-balance rule leaves it alone.
  const byAccount = new Map(balanceTotals.map((total) => [total.accountId, total]));
  const accountBalances = accounts.map((account) => ({
    accountId: account.id,
    accountName: account.name,
    currency: account.currency,
    transactionCount: byAccount.get(account.id)?.transactionCount ?? 0,
    balance: byAccount.get(account.id)?.balance ?? new Decimal(0),
  }));

  const candidates = [
    ...evaluateLowBalance(accountBalances, ruleFor("LOW_BALANCE")),
    ...evaluateBudgetOverrun(buildBudgetReport(budgets, monthSeries.transactions), ruleFor("BUDGET_OVERRUN"), {
      monthKey,
      truncated: monthSeries.truncated,
    }),
    ...evaluateUnusualExpense(monthSeries.transactions, ruleFor("UNUSUAL_EXPENSE"), {
      truncated: monthSeries.truncated,
    }),
    ...evaluateStaleIntegration(connections, ruleFor("STALE_INTEGRATION"), { now }),
    ...evaluateOverdueEvent(dueCashflows, ruleFor("OVERDUE_EVENT"), { now }),
  ];

  const plan = planAlertChanges(
    existing.map((alert) => ({
      id: alert.id,
      fingerprint: alert.fingerprint,
      status: alert.status,
    })),
    candidates,
  );

  await applyAlertPlan(userId, plan, now);

  const statusById = new Map(existing.map((alert) => [alert.id, alert.status]));
  const resolvedActive = plan.resolves.filter((id) => statusById.get(id) === "ACTIVE").length;
  const activeBefore = existing.filter((alert) => alert.status === "ACTIVE").length;

  return {
    created: plan.creates.length,
    refreshed: plan.refreshes.length,
    reopened: plan.reopens.length,
    resolved: plan.resolves.length,
    active: activeBefore - resolvedActive + plan.creates.length + plan.reopens.length,
  };
}
