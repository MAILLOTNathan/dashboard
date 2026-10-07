import { requireApiUser, unauthorizedResponse } from "@/lib/auth/guard";
import { createCsvResponse, toCsv, type CsvColumn } from "@/lib/csv";
import { currentMonthKey, isValidMonthKey, parseMonthKey } from "@/lib/dates";
import { listBudgets } from "@/modules/budget/repository";

/**
 * CSV export of the monthly budgets.
 *
 * One month per file, like the transactions export: the month is the filter, an absent
 * or malformed `month` falls back to the current one. The read is bounded by its own
 * shape — one row per budgeted category and currency — so no row cap is needed here.
 */
export const dynamic = "force-dynamic";

type BudgetRow = {
  month: string;
  category: string;
  kind: string;
  currency: string;
  amount: string;
};

const COLUMNS: CsvColumn<BudgetRow>[] = [
  { key: "month", header: "mois" },
  { key: "category", header: "categorie" },
  { key: "kind", header: "nature" },
  { key: "currency", header: "devise" },
  { key: "amount", header: "montant_prevu" },
];

export async function GET(request: Request): Promise<Response> {
  const user = await requireApiUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month");
  const monthKey = isValidMonthKey(monthParam) ? monthParam : currentMonthKey();
  const { year, month } = parseMonthKey(monthKey);

  const budgets = await listBudgets(user.id, { year, month });

  const rows: BudgetRow[] = budgets.map((budget) => ({
    month: monthKey,
    category: budget.categoryName,
    // Raw kind, like the transactions export keeps the raw type: the file is data.
    kind: budget.categoryKind,
    currency: budget.currency,
    // Exact decimal string: no float, no thousands separator, dot as separator.
    amount: budget.amount.toFixed(2),
  }));

  return createCsvResponse(toCsv(rows, COLUMNS), `budgets-${monthKey}.csv`);
}
