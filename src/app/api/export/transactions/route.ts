import { requireApiUser, unauthorizedResponse } from "@/lib/auth/guard";
import { createCsvResponse, EXPORT_ROW_LIMIT, toCsv, type CsvColumn } from "@/lib/csv";
import {
  currentMonthKey,
  isValidMonthKey,
  monthRange,
  parseMonthKey,
  toDateOnlyString,
  yearRange,
} from "@/lib/dates";
import { TRANSACTION_TYPES, type TransactionType } from "@/modules/budget/domain";
import { listTransactions } from "@/modules/budget/repository";

/**
 * CSV export of the transactions.
 *
 * Personal data leaves the application only through an authenticated request: the
 * session is checked here, server-side, before any row is read.
 *
 * Scope: a month by default (`?month=YYYY-MM`), a whole year (`?year=YYYY`) or every
 * month (`?all=1`). The filters of the operations tab (account, category, type, search,
 * reconciliation) are honoured in every scope, so the file matches what the screen
 * showed. The reconciliation day is exported as its own column: an empty cell means
 * "not checked yet", which is a state, not a missing date.
 */
export const dynamic = "force-dynamic";

type TransactionRow = {
  operationDate: string;
  label: string;
  account: string;
  category: string;
  type: string;
  amount: string;
  currency: string;
  reconciledOn: string;
  notes: string;
  sourceRef: string;
};

const COLUMNS: CsvColumn<TransactionRow>[] = [
  { key: "operationDate", header: "date_operation" },
  { key: "label", header: "libelle" },
  { key: "account", header: "compte" },
  { key: "category", header: "categorie" },
  { key: "type", header: "type" },
  { key: "amount", header: "montant" },
  { key: "currency", header: "devise" },
  { key: "reconciledOn", header: "pointe_le" },
  { key: "notes", header: "notes" },
  { key: "sourceRef", header: "reference_source" },
];

export async function GET(request: Request): Promise<Response> {
  const user = await requireApiUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const url = new URL(request.url);
  const allScope = url.searchParams.get("all") === "1";
  const yearParam = url.searchParams.get("year");
  const yearRequested = /^\d{4}$/.test(yearParam ?? "") ? Number(yearParam) : null;
  const monthParam = url.searchParams.get("month");
  const month = isValidMonthKey(monthParam) ? monthParam : currentMonthKey();
  const { year, month: monthNumber } = parseMonthKey(month);

  // One scope, decided once: every month, a whole year, or the displayed month.
  let window: { from?: Date; to?: Date } = {};
  let fileName = "transactions-complet.csv";

  if (!allScope) {
    if (yearRequested !== null) {
      const bounds = yearRange(yearRequested);
      window = { from: bounds.start, to: bounds.end };
      fileName = `transactions-${yearRequested}.csv`;
    } else {
      const range = monthRange(year, monthNumber);
      window = { from: range.start, to: range.end };
      fileName = `transactions-${month}.csv`;
    }
  }

  const rawType = url.searchParams.get("type");
  const type = TRANSACTION_TYPES.find((value) => value === rawType) as
    | TransactionType
    | undefined;
  const rawReconciled = url.searchParams.get("reconciled");

  const transactions = await listTransactions(user.id, {
    ...window,
    accountId: url.searchParams.get("account") ?? undefined,
    categoryId: url.searchParams.get("category") ?? undefined,
    type,
    search: url.searchParams.get("q") ?? undefined,
    reconciled:
      rawReconciled === "0" ? false : rawReconciled === "1" ? true : undefined,
    // Bounded, not streamed: see EXPORT_ROW_LIMIT in `lib/csv.ts`.
    take: EXPORT_ROW_LIMIT,
  });

  const rows: TransactionRow[] = transactions.map((transaction) => ({
    operationDate: toDateOnlyString(transaction.operationDate),
    label: transaction.label,
    account: transaction.accountName ?? "",
    category: transaction.categoryName ?? "",
    type: transaction.type,
    // Exact decimal string: no float, no thousands separator, dot as separator.
    amount: transaction.amount.toFixed(2),
    currency: transaction.currency,
    reconciledOn:
      transaction.reconciledAt === null ? "" : toDateOnlyString(transaction.reconciledAt),
    notes: transaction.notes ?? "",
    sourceRef: transaction.externalRef ?? "",
  }));

  return createCsvResponse(toCsv(rows, COLUMNS), fileName);
}
