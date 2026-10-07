import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guard";
import { currentMonthKey, formatMonthLabel, isValidMonthKey, parseMonthKey } from "@/lib/dates";
import { readSearchParam, type SearchParamsInput } from "@/lib/search-params";
import { TRANSACTION_TYPES, type TransactionType } from "@/modules/budget/domain";
import { AnalysisSection } from "./analysis-section";
import type { BudgetFilterValues } from "./budget-filters";
import { BudgetTabs, resolveBudgetTab, type BudgetTab } from "./budget-tabs";
import { BudgetsSection } from "./budgets-section";
import { ForecastSection } from "./forecast-section";
import { GoalsSection } from "./goals-section";
import { OperationsSection } from "./operations-section";
import { ReportSection } from "./report-section";
import { SalarySection } from "./salary-section";
import { SavingsThresholdCard } from "./savings-threshold-card";

export const dynamic = "force-dynamic";

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const requestedMonth = readSearchParam(params, "month");
  const monthKey = isValidMonthKey(requestedMonth) ? requestedMonth : currentMonthKey();
  const { year, month } = parseMonthKey(monthKey);
  const monthLabel = formatMonthLabel(year, month);

  const rawType = readSearchParam(params, "type");
  const filters: BudgetFilterValues = {
    accountId: readSearchParam(params, "account"),
    categoryId: readSearchParam(params, "category"),
    type: TRANSACTION_TYPES.find((value) => value === rawType),
    search: readSearchParam(params, "q"),
  };
  // Which side of the ledger the breakdown shows. Expenses by default: that is the
  // question people actually ask.
  const breakdownKind: TransactionType =
    readSearchParam(params, "breakdown") === "INCOME" ? "INCOME" : "EXPENSE";

  // The rows being corrected are read by the sections from the owner's own data, never
  // taken from the query string: `?edit=`, `?editBudget=` and `?editGoal=` are identifiers
  // to look up, not authorisations.
  const editId = readSearchParam(params, "edit");
  const editBudgetId = readSearchParam(params, "editBudget");
  const editGoalId = readSearchParam(params, "editGoal");

  const tab = resolveBudgetTab(readSearchParam(params, "tab"), { editBudgetId, editGoalId });

  // Month and filters travel from tab to tab (and to the CSV export), so switching a
  // section never silently changes what is displayed. Edition identifiers are left out:
  // opening a tab leaves the correction flow instead of replaying it.
  const baseParams = new URLSearchParams({ month: monthKey });
  if (filters.accountId) baseParams.set("account", filters.accountId);
  if (filters.categoryId) baseParams.set("category", filters.categoryId);
  if (filters.type) baseParams.set("type", filters.type);
  if (filters.search) baseParams.set("q", filters.search);

  const descriptions: Record<BudgetTab, string> = {
    operations: `Opérations de ${monthLabel}. Les montants sont signés : une sortie est négative.`,
    analysis: `Analyse de ${monthLabel} : totaux, tendance sur 12 mois et répartition par catégorie. Les transferts entre comptes comptent selon leur signe.`,
    budgets: `Budgets de ${monthLabel}, par catégorie et par devise. Les devises ne sont jamais converties.`,
    report: `Suivi du budget de ${monthLabel} : prévu, réalisé et reste par catégorie et par devise, sans conversion.`,
    forecast: `Prévisions de ${monthLabel} : échéances attendues des séries récurrentes et salaire simulé du mois, à confirmer. Rien ne compte dans un total avant d'être enregistré.`,
    goals: "Objectifs d'épargne ou de remboursement : progression, reste à atteindre et contribution mensuelle. Un solde inconnu ne vaut jamais zéro, et aucune devise n'est convertie.",
    salary: `Salaire simulé de ${monthLabel} : un taux horaire, un calendrier de jours prévus puis travaillés, et la recette du mois en un clic.`,
  };

  return (
    <>
      <PageHeader
        title="Budget"
        description={descriptions[tab]}
        actions={
          <Link
            href={`/api/export/transactions?${baseParams.toString()}`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Exporter en CSV
          </Link>
        }
      />

      <BudgetTabs current={tab} baseParams={baseParams} />

      {tab === "operations" ? (
        <OperationsSection
          userId={user.id}
          monthKey={monthKey}
          filters={filters}
          editId={editId}
        />
      ) : null}

      {tab === "analysis" ? (
        <AnalysisSection
          userId={user.id}
          monthKey={monthKey}
          filters={filters}
          breakdownKind={breakdownKind}
        />
      ) : null}

      {tab === "budgets" ? (
        <BudgetsSection userId={user.id} monthKey={monthKey} editBudgetId={editBudgetId} />
      ) : null}

      {tab === "report" ? <ReportSection userId={user.id} monthKey={monthKey} /> : null}

      {tab === "forecast" ? (
        <ForecastSection userId={user.id} monthKey={monthKey} />
      ) : null}

      {tab === "goals" ? (
        <>
          <SavingsThresholdCard userId={user.id} />
          <GoalsSection userId={user.id} editGoalId={editGoalId} />
        </>
      ) : null}

      {tab === "salary" ? <SalarySection userId={user.id} monthKey={monthKey} /> : null}
    </>
  );
}
