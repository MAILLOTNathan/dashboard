import { requireApiUser, unauthorizedResponse } from "@/lib/auth/guard";
import { createCsvResponse, EXPORT_ROW_LIMIT, toCsv, type CsvColumn } from "@/lib/csv";
import {
  currentMonthKey,
  isValidMonthKey,
  monthRange,
  parseMonthKey,
  toDateOnlyString,
} from "@/lib/dates";
import { TRANSACTION_TYPES, type TransactionType } from "@/modules/budget/domain";
import { listTransactions } from "@/modules/budget/repository";

/**
 * CSV export of the transactions.
 *
 * Personal data leaves the application only through an authenticated request:
 * the session is checked here, server-side, before any row is read.
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
  { key: "notes", header: "notes" },
  { key: "sourceRef", header: "reference_source" },
];

export async function GET(request: Request): Promise<Response> {
  const user = await requireApiUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month");
  const month = isValidMonthKey(monthParam) ? monthParam : currentMonthKey();
  const { year, month: monthNumber } = parseMonthKey(month);
  const range = monthRange(year, monthNumber);

  const rawType = url.searchParams.get("type");
  const type = TRANSACTION_TYPES.find((value) => value === rawType) as
    | TransactionType
    | undefined;

  const transactions = await listTransactions(user.id, {
    from: range.start,
    to: range.end,
    accountId: url.searchParams.get("account") ?? undefined,
    categoryId: url.searchParams.get("category") ?? undefined,
    type,
    search: url.searchParams.get("q") ?? undefined,
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
    notes: transaction.notes ?? "",
    sourceRef: transaction.externalRef ?? "",
  }));

  return createCsvResponse(toCsv(rows, COLUMNS), `transactions-${month}.csv`);
}
