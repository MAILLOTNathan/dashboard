import Decimal from "decimal.js";
import { getPrisma } from "@/lib/db";
import { assertCurrency, type Currency } from "@/lib/money";
import type {
  AccountSummary,
  AccountType,
  CategorySummary,
  TransactionRecord,
  TransactionType,
} from "./domain";

/**
 * Budget persistence.
 *
 * Every function takes the owner identifier and filters on it: a query that
 * forgets the owner would expose another account's data.
 */

export type TransactionFilters = {
  from?: Date;
  to?: Date;
  accountId?: string;
  categoryId?: string;
  type?: TransactionType;
  search?: string;
  take?: number;
};

const DEFAULT_PAGE_SIZE = 200;

export async function listAccounts(userId: string): Promise<AccountSummary[]> {
  const rows = await getPrisma().account.findMany({
    where: { userId, archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, type: true, currency: true },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as AccountType,
    currency: assertCurrency(row.currency),
  }));
}

export async function listCategories(userId: string): Promise<CategorySummary[]> {
  const rows = await getPrisma().category.findMany({
    where: { userId },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: { id: true, name: true, kind: true },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
  }));
}

export async function listTransactions(
  userId: string,
  filters: TransactionFilters = {},
): Promise<TransactionRecord[]> {
  const rows = await getPrisma().transaction.findMany({
    where: {
      userId,
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.search
        ? { label: { contains: filters.search, mode: "insensitive" as const } }
        : {}),
      ...(filters.from || filters.to
        ? {
            operationDate: {
              // The upper bound is exclusive: see `monthRange`.
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lt: filters.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ operationDate: "desc" }, { createdAt: "desc" }],
    take: filters.take ?? DEFAULT_PAGE_SIZE,
    select: {
      id: true,
      type: true,
      amount: true,
      currency: true,
      operationDate: true,
      label: true,
      accountId: true,
      categoryId: true,
      notes: true,
      externalRef: true,
      account: { select: { name: true } },
      category: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    type: row.type as TransactionType,
    // Prisma exposes a numeric type: converting through its string form keeps the
    // value exact and gives the domain a plain decimal.js instance.
    amount: new Decimal(row.amount.toString()),
    currency: assertCurrency(row.currency),
    operationDate: row.operationDate,
    label: row.label,
    accountId: row.accountId,
    accountName: row.account.name,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    notes: row.notes,
    externalRef: row.externalRef,
  }));
}

export async function countTransactions(userId: string): Promise<number> {
  return getPrisma().transaction.count({ where: { userId } });
}

/**
 * Rows a chart window may read.
 *
 * A year of manual entries is far below this bound. It exists so a pathological
 * window cannot pull an unbounded result set into the page, and reaching it is
 * reported through `truncated`: a chart that quietly under-reports a year would be
 * exactly the kind of silent lie this dashboard avoids.
 */
export const SERIES_ROW_LIMIT = 5000;

/**
 * Transactions covering a full window, for the charts.
 *
 * Deliberately separate from `listTransactions`: the table shows a page, a series
 * needs every row of its window, and the two bounds are different on purpose.
 */
export async function listTransactionsForSeries(
  userId: string,
  filters: TransactionFilters,
): Promise<{ transactions: TransactionRecord[]; truncated: boolean }> {
  // One row more than the bound: its presence is what proves the window was cut.
  const rows = await listTransactions(userId, { ...filters, take: SERIES_ROW_LIMIT + 1 });
  const truncated = rows.length > SERIES_ROW_LIMIT;

  return { transactions: truncated ? rows.slice(0, SERIES_ROW_LIMIT) : rows, truncated };
}

/**
 * Deletes one transaction of this owner.
 *
 * `deleteMany` with the owner in the `where` clause rather than a read followed by a
 * delete: one statement, and a foreign identifier simply matches nothing instead of
 * having to be compared first. The returned count says whether anything was removed,
 * so the caller can tell "deleted" from "already gone or not yours".
 */
export async function deleteTransaction(
  userId: string,
  transactionId: string,
): Promise<boolean> {
  const { count } = await getPrisma().transaction.deleteMany({
    where: { id: transactionId, userId },
  });

  return count === 1;
}

/**
 * Owner-scoped account lookup.
 *
 * An identifier coming from a form is never trusted: filtering on `userId` means
 * a foreign identifier is simply not found. The account also carries the currency
 * of the transactions recorded on it.
 */
export async function findAccount(
  userId: string,
  accountId: string,
): Promise<AccountSummary | null> {
  const row = await getPrisma().account.findFirst({
    where: { id: accountId, userId, archivedAt: null },
    select: { id: true, name: true, type: true, currency: true },
  });

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    type: row.type as AccountType,
    currency: assertCurrency(row.currency),
  };
}

/** Owner-scoped category lookup, used the same way as `findAccount`. */
export async function findCategory(
  userId: string,
  categoryId: string,
): Promise<CategorySummary | null> {
  const row = await getPrisma().category.findFirst({
    where: { id: categoryId, userId },
    select: { id: true, name: true, kind: true },
  });

  return row ? { id: row.id, name: row.name, kind: row.kind } : null;
}

/**
 * Light owner-scoped transaction lookup.
 *
 * Used to link a real-estate cashflow entry to a transaction: the entry stores
 * no amount of its own, so it needs the transaction's currency and label.
 */
export async function findTransactionRef(
  userId: string,
  transactionId: string,
): Promise<{ id: string; label: string; currency: Currency } | null> {
  const row = await getPrisma().transaction.findFirst({
    where: { id: transactionId, userId },
    select: { id: true, label: true, currency: true },
  });

  return row ? { id: row.id, label: row.label, currency: assertCurrency(row.currency) } : null;
}

export async function createAccount(input: {
  userId: string;
  name: string;
  type: AccountType;
  currency: Currency;
}): Promise<{ id: string }> {
  return getPrisma().account.create({
    data: {
      userId: input.userId,
      name: input.name.trim(),
      type: input.type,
      currency: input.currency,
    },
    select: { id: true },
  });
}

export async function createCategory(input: {
  userId: string;
  name: string;
  kind: CategorySummary["kind"];
}): Promise<{ id: string }> {
  return getPrisma().category.create({
    data: { userId: input.userId, name: input.name.trim(), kind: input.kind },
    select: { id: true },
  });
}

/**
 * Creates a transaction.
 *
 * `externalRef` is the source identifier of an imported record: the unique
 * constraint on (accountId, externalRef) makes a repeated import fail instead of
 * duplicating a line.
 */
export async function createTransaction(input: {
  userId: string;
  accountId: string;
  categoryId: string | null;
  type: TransactionType;
  label: string;
  amount: Decimal;
  currency: Currency;
  operationDate: Date;
  notes: string | null;
  externalRef?: string | null;
}): Promise<{ id: string }> {
  return getPrisma().transaction.create({
    data: {
      userId: input.userId,
      accountId: input.accountId,
      categoryId: input.categoryId,
      type: input.type,
      label: input.label.trim(),
      amount: input.amount.toFixed(2),
      currency: input.currency,
      operationDate: input.operationDate,
      notes: input.notes,
      externalRef: input.externalRef ?? null,
    },
    select: { id: true },
  });
}
