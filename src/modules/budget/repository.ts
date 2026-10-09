import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import { isUniqueConstraintError } from "@/lib/actions";
import { getPrisma } from "@/lib/db";
import { assertCurrency, type Currency } from "@/lib/money";
import type {
  AccountSummary,
  AccountType,
  BudgetIdentity,
  BudgetRecord,
  CategoryKind,
  CategorySummary,
  TransactionRecord,
  TransactionType,
} from "./domain";
import type { SalaryRateRecord, SalarySettingRecord, WorkDayRecord, WorkDayStatus } from "./salary";
import {
  plannedOccurrences,
  type ForecastType,
  type RecurrenceFrequency,
  type RecurringEntryRecord,
  type RecurringOccurrenceRecord,
  type RecurringOccurrenceStatus,
} from "./recurrence";
import type { GoalContributionRecord, GoalRecord, GoalStatus } from "./goals";
import type { LabelUsage } from "./suggestions";
import { signedTransferLegs } from "./transfers";

/**
 * Budget persistence.
 *
 * Every function takes the owner identifier and filters on it: a query that
 * forgets the owner would expose another account's data.
 */

export const TRANSACTION_SORTS = ["date", "amount", "label"] as const;
export type TransactionSort = (typeof TRANSACTION_SORTS)[number];

export type TransactionFilters = {
  from?: Date;
  to?: Date;
  accountId?: string;
  categoryId?: string;
  type?: TransactionType;
  search?: string;
  /** `true` = only reconciled rows, `false` = only unchecked ones, absent = all. */
  reconciled?: boolean;
  /** Whitelisted sort column; the default is the operation date. */
  sort?: TransactionSort;
  dir?: "asc" | "desc";
  /** Rows to skip, for pagination. */
  skip?: number;
  take?: number;
};

/** The table page size; exported so the pagination UI and the read cannot drift apart. */
export const TRANSACTION_PAGE_SIZE = 200;

/** The shared `where` of every filtered transaction read (list, count, export). */
function transactionWhere(userId: string, filters: TransactionFilters) {
  return {
    userId,
    ...(filters.accountId ? { accountId: filters.accountId } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.search
      ? { label: { contains: filters.search, mode: "insensitive" as const } }
      : {}),
    ...(filters.reconciled === undefined
      ? {}
      : filters.reconciled
        ? { reconciledAt: { not: null } }
        : { reconciledAt: null }),
    ...(filters.from || filters.to
      ? {
          operationDate: {
            // The upper bound is exclusive: see `monthRange`.
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lt: filters.to } : {}),
          },
        }
      : {}),
  };
}

/** The sort whitelist, applied with a stable tiebreak on the operation date. */
function transactionOrderBy(
  filters: TransactionFilters,
): { operationDate?: "asc" | "desc"; createdAt?: "asc" | "desc"; amount?: "asc" | "desc"; label?: "asc" | "desc" }[] {
  const dir = filters.dir ?? "desc";

  switch (filters.sort) {
    case "amount":
      return [{ amount: dir }, { operationDate: "desc" }, { createdAt: "desc" }];
    case "label":
      return [{ label: dir }, { operationDate: "desc" }, { createdAt: "desc" }];
    default:
      return [{ operationDate: dir }, { createdAt: dir }];
  }
}

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

/**
 * Columns every transaction read shares.
 *
 * The table and the edition form must show the same row, so the projection lives in one
 * place: two `select` clauses that drift apart are how a field ends up editable in one
 * view and missing from the other.
 */
const TRANSACTION_SELECT = {
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
  transferGroupId: true,
  reconciledAt: true,
  createdAt: true,
  account: { select: { name: true } },
  category: { select: { name: true } },
} as const;

/** Declared structurally, so the mapper does not depend on the generated client type. */
type TransactionRow = {
  id: string;
  type: string;
  amount: { toString(): string };
  currency: string;
  operationDate: Date;
  label: string;
  accountId: string;
  categoryId: string | null;
  notes: string | null;
  externalRef: string | null;
  transferGroupId: string | null;
  reconciledAt: Date | null;
  createdAt: Date;
  account: { name: string };
  category: { name: string } | null;
};

function toTransactionRecord(row: TransactionRow): TransactionRecord {
  return {
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
    transferGroupId: row.transferGroupId,
    reconciledAt: row.reconciledAt,
    createdAt: row.createdAt,
  };
}

export async function listTransactions(
  userId: string,
  filters: TransactionFilters = {},
): Promise<TransactionRecord[]> {
  const rows = await getPrisma().transaction.findMany({
    where: transactionWhere(userId, filters),
    orderBy: transactionOrderBy(filters),
    ...(filters.skip ? { skip: filters.skip } : {}),
    take: filters.take ?? TRANSACTION_PAGE_SIZE,
    select: TRANSACTION_SELECT,
  });

  return rows.map(toTransactionRecord);
}

/**
 * One transaction, scoped to its owner.
 *
 * Read before an edition so the form shows what the row actually holds, rather than what
 * a query string asked for: an identifier belonging to someone else returns nothing.
 */
export async function findTransaction(
  userId: string,
  transactionId: string,
): Promise<TransactionRecord | null> {
  const row = await getPrisma().transaction.findFirst({
    where: { id: transactionId, userId },
    select: TRANSACTION_SELECT,
  });

  return row ? toTransactionRecord(row) : null;
}

/**
 * One transaction by its import reference, owner-scoped.
 *
 * The salary booking stores a stable reference (`salary:2026-10`) so its tab can tell
 * "already recorded" from "to record" without matching on a label, which the owner may
 * have edited afterwards.
 */
export async function findTransactionByExternalRef(
  userId: string,
  externalRef: string,
): Promise<TransactionRecord | null> {
  const row = await getPrisma().transaction.findFirst({
    where: { userId, externalRef },
    select: TRANSACTION_SELECT,
  });

  return row ? toTransactionRecord(row) : null;
}

/** Counts the filtered rows, so the table can render an honest "page 2 of N". */
export async function countTransactions(
  userId: string,
  filters: TransactionFilters = {},
): Promise<number> {
  return getPrisma().transaction.count({ where: transactionWhere(userId, filters) });
}

/**
 * Distinct labels the owner already typed, bounded before being ranked.
 *
 * The bound is on the most used labels on purpose: the ranking in
 * `buildLabelSuggestions` keeps twenty of them, so reading every distinct label of a
 * long history would fetch rows that can never be shown.
 */
export const LABEL_HISTORY_LIMIT = 200;

/**
 * Labels already used, with how often and how recently.
 *
 * Grouped in the database rather than read from the last page of transactions: a label
 * used every month for a year would otherwise be pushed out by one busy week, and a
 * suggestion list that forgets the rent is worse than no list at all.
 *
 * Case is not folded here. Near-duplicate spellings are merged in the module, which is
 * the only place that decides what counts as the same label.
 */
export async function listLabelHistory(
  userId: string,
  limit: number = LABEL_HISTORY_LIMIT,
): Promise<LabelUsage[]> {
  const rows = await getPrisma().transaction.groupBy({
    by: ["label"],
    where: { userId },
    _count: { _all: true },
    _max: { operationDate: true },
    orderBy: { _count: { label: "desc" } },
    take: limit,
  });

  return rows.map((row) => ({
    label: row.label,
    usageCount: row._count._all,
    // Prisma types an aggregate as nullable even though `operationDate` is NOT NULL.
    // The fallback only affects the ordering of a case that cannot occur.
    lastUsedOn: row._max.operationDate ?? new Date(0),
  }));
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
 * Deletes one transaction of this owner — or, when it belongs to a linked transfer,
 * the whole group.
 *
 * Both legs of a virement are one movement: deleting one half would leave the other
 * dangling and unbalanced. The returned counters let the action say exactly what was
 * removed, rather than a generic "deleted".
 */
export async function deleteTransaction(
  userId: string,
  transactionId: string,
): Promise<{ deleted: boolean; deletedCount: number; grouped: boolean }> {
  const prisma = getPrisma();
  const row = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
    select: { transferGroupId: true },
  });

  if (!row) {
    return { deleted: false, deletedCount: 0, grouped: false };
  }

  if (row.transferGroupId) {
    const { count } = await prisma.transaction.deleteMany({
      where: { userId, transferGroupId: row.transferGroupId },
    });

    return { deleted: count > 0, deletedCount: count, grouped: true };
  }

  const { count } = await prisma.transaction.deleteMany({
    where: { id: transactionId, userId },
  });

  return { deleted: count === 1, deletedCount: count, grouped: false };
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
 * A category by name and kind, created on first use when the owner does not have it yet.
 *
 * Used to guarantee the default category a feature names (« Salaire » for the salary
 * booking): an owner who never created one still needs it. The unique (userId, name,
 * kind) is the race guard — a lost race re-reads the row the other request created
 * instead of failing.
 */
export async function ensureCategory(input: {
  userId: string;
  name: string;
  kind: CategoryKind;
}): Promise<CategorySummary> {
  const where = { userId: input.userId, name: input.name, kind: input.kind };
  const select = { id: true, name: true, kind: true } as const;

  const existing = await getPrisma().category.findFirst({ where, select });
  if (existing) {
    return existing;
  }

  try {
    return await getPrisma().category.create({
      data: { userId: input.userId, name: input.name, kind: input.kind },
      select,
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const raced = await getPrisma().category.findFirst({ where, select });
    if (!raced) {
      throw error;
    }

    return raced;
  }
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

/** The management view of accounts: archived state included, balances joined by the caller. */
export type AccountManagementRecord = {
  id: string;
  name: string;
  type: AccountType;
  currency: Currency;
  archivedAt: Date | null;
};

/** Every account of the owner, archived ones included, oldest first. */
export async function listAccountsForManagement(
  userId: string,
): Promise<AccountManagementRecord[]> {
  const rows = await getPrisma().account.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, name: true, type: true, currency: true, archivedAt: true },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as AccountType,
    currency: assertCurrency(row.currency),
    archivedAt: row.archivedAt,
  }));
}

/** One account by identifier, archived ones included; used by the management screen. */
export async function findManagedAccount(
  userId: string,
  accountId: string,
): Promise<AccountManagementRecord | null> {
  const row = await getPrisma().account.findFirst({
    where: { id: accountId, userId },
    select: { id: true, name: true, type: true, currency: true, archivedAt: true },
  });

  return row
    ? {
        id: row.id,
        name: row.name,
        type: row.type as AccountType,
        currency: assertCurrency(row.currency),
        archivedAt: row.archivedAt,
      }
    : null;
}

/** How many transactions the account holds, used before a currency change. */
export async function countAccountTransactions(
  userId: string,
  accountId: string,
): Promise<number> {
  return getPrisma().transaction.count({ where: { userId, accountId } });
}

/** Replaces the editable fields of one account; `false` means "gone or not yours". */
export async function updateAccount(
  userId: string,
  accountId: string,
  input: { name: string; type: AccountType; currency: Currency },
): Promise<boolean> {
  const { count } = await getPrisma().account.updateMany({
    where: { id: accountId, userId },
    data: { name: input.name.trim(), type: input.type, currency: input.currency },
  });

  return count === 1;
}

/**
 * Archives or restores an account.
 *
 * Archiving is the honest alternative to deletion: the account disappears from the entry
 * forms and the alert engine, while its history stays readable. Restoring only clears the
 * stamp — nothing else about the account changes.
 */
export async function setAccountArchived(
  userId: string,
  accountId: string,
  archived: boolean,
): Promise<boolean> {
  const { count } = await getPrisma().account.updateMany({
    where: { id: accountId, userId },
    data: { archivedAt: archived ? new Date() : null },
  });

  return count === 1;
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

/** How many transactions the category carries, used before a kind change. */
export async function countCategoryTransactions(
  userId: string,
  categoryId: string,
): Promise<number> {
  return getPrisma().transaction.count({ where: { userId, categoryId } });
}

/**
 * What hangs off a category, per reference kind. Used before a kind change: moving an
 * expense category to income would re-label existing envelopes and transactions.
 */
export async function countCategoryReferences(
  userId: string,
  categoryId: string,
): Promise<{ transactions: number; budgets: number; recurring: number }> {
  const prisma = getPrisma();
  const [transactions, budgets, recurring] = await Promise.all([
    prisma.transaction.count({ where: { userId, categoryId } }),
    prisma.budget.count({ where: { userId, categoryId } }),
    prisma.recurringEntry.count({ where: { userId, categoryId } }),
  ]);

  return { transactions, budgets, recurring };
}

/** Renames a category, or moves it between kinds. `false` means "gone or not yours". */
export async function updateCategory(
  userId: string,
  categoryId: string,
  input: { name: string; kind: CategoryKind },
): Promise<boolean> {
  const { count } = await getPrisma().category.updateMany({
    where: { id: categoryId, userId },
    data: { name: input.name.trim(), kind: input.kind },
  });

  return count === 1;
}

/** One category with how much of the owner's data hangs off it. */
export type CategoryUsage = {
  id: string;
  name: string;
  kind: CategoryKind;
  transactionCount: number;
  budgetCount: number;
  recurringCount: number;
};

/**
 * The owner's categories with their usage counts, so the management screen can warn
 * before a kind change, a merge or a deletion instead of surprising the owner.
 */
export async function listCategoryUsage(userId: string): Promise<CategoryUsage[]> {
  const prisma = getPrisma();
  const [categories, transactions, budgets, recurring] = await Promise.all([
    listCategories(userId),
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: { userId, categoryId: { not: null } },
      _count: { _all: true },
    }),
    prisma.budget.groupBy({
      by: ["categoryId"],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.recurringEntry.groupBy({
      by: ["categoryId"],
      where: { userId, categoryId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const transactionCounts = new Map(
    transactions.map((row) => [row.categoryId, row._count._all]),
  );
  const budgetCounts = new Map(budgets.map((row) => [row.categoryId, row._count._all]));
  const recurringCounts = new Map(
    recurring.map((row) => [row.categoryId, row._count._all]),
  );

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    kind: category.kind,
    transactionCount: transactionCounts.get(category.id) ?? 0,
    budgetCount: budgetCounts.get(category.id) ?? 0,
    recurringCount: recurringCounts.get(category.id) ?? 0,
  }));
}

export type CategoryMergeSummary = {
  movedTransactions: number;
  movedRecurring: number;
  movedBudgets: number;
  /** Source budgets the target already covered: deleted, and counted out loud. */
  droppedBudgets: number;
};

/**
 * Merges one category into another, in a single transaction.
 *
 * Transactions and recurring series are repointed, budgets move where the target has no
 * budget for the same (year, month, currency) and are deleted where it has one — the
 * target's plan already covers that period, and the counter reports the deletion so it is
 * never silent. The source row is deleted last; a lost race mid-way rolls everything back.
 * `null` means the source does not exist (or is not the owner's).
 */
export async function mergeCategories(
  userId: string,
  sourceId: string,
  targetId: string,
): Promise<CategoryMergeSummary | null> {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const source = await tx.category.findFirst({ where: { id: sourceId, userId } });
    if (!source) {
      return null;
    }

    const movedTransactions = (
      await tx.transaction.updateMany({
        where: { userId, categoryId: sourceId },
        data: { categoryId: targetId },
      })
    ).count;

    const movedRecurring = (
      await tx.recurringEntry.updateMany({
        where: { userId, categoryId: sourceId },
        data: { categoryId: targetId },
      })
    ).count;

    const sourceBudgets = await tx.budget.findMany({
      where: { userId, categoryId: sourceId },
      select: { id: true, year: true, month: true, currency: true },
    });
    const targetKeys = new Set(
      (
        await tx.budget.findMany({
          where: { userId, categoryId: targetId },
          select: { year: true, month: true, currency: true },
        })
      ).map((budget) => `${budget.year}-${budget.month}-${budget.currency}`),
    );

    const conflicting = sourceBudgets
      .filter((budget) => targetKeys.has(`${budget.year}-${budget.month}-${budget.currency}`))
      .map((budget) => budget.id);
    const movable = sourceBudgets
      .filter((budget) => !targetKeys.has(`${budget.year}-${budget.month}-${budget.currency}`))
      .map((budget) => budget.id);

    const movedBudgets =
      movable.length === 0
        ? 0
        : (
            await tx.budget.updateMany({
              where: { userId, id: { in: movable } },
              data: { categoryId: targetId },
            })
          ).count;

    const droppedBudgets =
      conflicting.length === 0
        ? 0
        : (
            await tx.budget.deleteMany({
              where: { userId, id: { in: conflicting } },
            })
          ).count;

    const { count } = await tx.category.deleteMany({ where: { id: sourceId, userId } });
    if (count !== 1) {
      // Rolling back beats a half-merged state: every write above is replayed or none is.
      throw new Error("Category merge could not delete its source row");
    }

    return { movedTransactions, movedRecurring, movedBudgets, droppedBudgets };
  });
}

/**
 * Deletes one category of this owner; `false` means "already gone or not yours".
 *
 * The schema rules take it from there: transactions lose their category (never their
 * amount), recurring series lose it too, and the category's budgets go with it — which
 * is why the UI shows the counts before asking for confirmation.
 */
export async function deleteCategory(
  userId: string,
  categoryId: string,
): Promise<boolean> {
  const { count } = await getPrisma().category.deleteMany({
    where: { id: categoryId, userId },
  });

  return count === 1;
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

/** Fields an edition may replace. `externalRef` is absent on purpose. */
export type TransactionWrite = {
  accountId: string;
  categoryId: string | null;
  type: TransactionType;
  label: string;
  amount: Decimal;
  currency: Currency;
  operationDate: Date;
  notes: string | null;
};

/**
 * Replaces the editable fields of one transaction.
 *
 * `updateMany` rather than `update`, for the same reason as the deletion: the owner
 * filter belongs in the `where` clause, and the number of written rows tells "edited"
 * from "gone or not yours" without a second read. `externalRef` is left alone, so a
 * corrected import stays marked as an import.
 */
export async function updateTransaction(
  userId: string,
  transactionId: string,
  input: TransactionWrite,
): Promise<boolean> {
  const { count } = await getPrisma().transaction.updateMany({
    where: { id: transactionId, userId },
    data: {
      accountId: input.accountId,
      categoryId: input.categoryId,
      type: input.type,
      label: input.label.trim(),
      amount: input.amount.toFixed(2),
      currency: input.currency,
      operationDate: input.operationDate,
      notes: input.notes,
    },
  });

  return count === 1;
}

/**
 * Writes the two legs of an internal transfer in one transaction.
 *
 * Both rows share a generated `transferGroupId`, so the pair can be shown and removed
 * as one thing afterwards. The amount handed in is the positive magnitude moved; the
 * sign split lives in `signedTransferLegs`, so the storage convention (source negative,
 * destination positive) is stated exactly once. No category is attached: a transfer is
 * neither a receipt nor a cost (see `categoryKindForTransactionType`).
 */
export async function createTransferGroup(input: {
  userId: string;
  fromAccountId: string;
  toAccountId: string;
  currency: Currency;
  /** Positive magnitude; the direction comes from the two accounts. */
  amount: Decimal;
  operationDate: Date;
  sourceLabel: string;
  destinationLabel: string;
  notes: string | null;
}): Promise<{ groupId: string; transactionIds: string[] }> {
  const prisma = getPrisma();
  const groupId = randomUUID();
  const legs = signedTransferLegs(input.amount);

  const shared = {
    userId: input.userId,
    categoryId: null,
    type: "TRANSFER" as const,
    currency: input.currency,
    operationDate: input.operationDate,
    notes: input.notes,
    externalRef: null,
    transferGroupId: groupId,
  };

  const [source, destination] = await prisma.$transaction([
    prisma.transaction.create({
      data: {
        ...shared,
        accountId: input.fromAccountId,
        label: input.sourceLabel.trim(),
        amount: legs.out.toFixed(2),
      },
      select: { id: true },
    }),
    prisma.transaction.create({
      data: {
        ...shared,
        accountId: input.toAccountId,
        label: input.destinationLabel.trim(),
        amount: legs.in.toFixed(2),
      },
      select: { id: true },
    }),
  ]);

  return { groupId, transactionIds: [source.id, destination.id] };
}

/**
 * Sets or clears the reconciliation day of one transaction.
 *
 * Only the tick moves: the amount, the date and the account are never touched, so a
 * correction stays the entry form's job. `false` means "gone or not yours".
 */
export async function setTransactionReconciled(input: {
  userId: string;
  transactionId: string;
  reconciled: boolean;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const { count } = await getPrisma().transaction.updateMany({
    where: { id: input.transactionId, userId: input.userId },
    data: { reconciledAt: input.reconciled ? day : null },
  });

  return count === 1;
}

/**
 * Monthly budgets.
 *
 * Owner-scoped like every other read: the tuple (category, year, month, currency) is
 * unique per owner, and every statement filters on `userId` — a foreign identifier is
 * simply not found.
 */

const BUDGET_SELECT = {
  id: true,
  categoryId: true,
  year: true,
  month: true,
  currency: true,
  amount: true,
  category: { select: { name: true, kind: true } },
} as const;

/** Declared structurally, so the mapper does not depend on the generated client type. */
type BudgetRow = {
  id: string;
  categoryId: string;
  year: number;
  month: number;
  currency: string;
  amount: { toString(): string };
  category: { name: string; kind: string };
};

function toBudgetRecord(row: BudgetRow): BudgetRecord {
  return {
    id: row.id,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    categoryKind: row.category.kind as CategoryKind,
    year: row.year,
    month: row.month,
    currency: assertCurrency(row.currency),
    // Prisma exposes a numeric type: converting through its string form keeps the
    // value exact and gives the domain a plain decimal.js instance.
    amount: new Decimal(row.amount.toString()),
  };
}

/** The budgets of one month, sorted so a currency's rows stay together. */
export async function listBudgets(
  userId: string,
  period: { year: number; month: number },
): Promise<BudgetRecord[]> {
  const rows = await getPrisma().budget.findMany({
    where: { userId, year: period.year, month: period.month },
    orderBy: [{ currency: "asc" }, { category: { name: "asc" } }],
    select: BUDGET_SELECT,
  });

  return rows.map(toBudgetRecord);
}

/** One budget, scoped to its owner: read before an edition so the form shows the row. */
export async function findBudget(
  userId: string,
  budgetId: string,
): Promise<BudgetRecord | null> {
  const row = await getPrisma().budget.findFirst({
    where: { id: budgetId, userId },
    select: BUDGET_SELECT,
  });

  return row ? toBudgetRecord(row) : null;
}

/** The row a (category, month, currency) tuple resolves to, if it exists. */
export async function findBudgetByPeriod(
  userId: string,
  identity: BudgetIdentity,
): Promise<BudgetRecord | null> {
  const row = await getPrisma().budget.findFirst({
    where: {
      userId,
      categoryId: identity.categoryId,
      year: identity.year,
      month: identity.month,
      currency: identity.currency,
    },
    select: BUDGET_SELECT,
  });

  return row ? toBudgetRecord(row) : null;
}

export async function createBudget(input: {
  userId: string;
  categoryId: string;
  year: number;
  month: number;
  currency: Currency;
  amount: Decimal;
}): Promise<{ id: string }> {
  return getPrisma().budget.create({
    data: {
      userId: input.userId,
      categoryId: input.categoryId,
      year: input.year,
      month: input.month,
      currency: input.currency,
      amount: input.amount.toFixed(2),
    },
    select: { id: true },
  });
}

/** Fields an edition may replace: everything except the owner. */
export type BudgetWrite = {
  categoryId: string;
  year: number;
  month: number;
  currency: Currency;
  amount: Decimal;
};

/**
 * Replaces the editable fields of one budget.
 *
 * `updateMany` + `count === 1`, the same contract as the other edits: the owner filter
 * belongs in the `where` clause, and a foreign identifier matches nothing.
 */
export async function updateBudget(
  userId: string,
  budgetId: string,
  input: BudgetWrite,
): Promise<boolean> {
  const { count } = await getPrisma().budget.updateMany({
    where: { id: budgetId, userId },
    data: {
      categoryId: input.categoryId,
      year: input.year,
      month: input.month,
      currency: input.currency,
      amount: input.amount.toFixed(2),
    },
  });

  return count === 1;
}

/** Deletes one budget of this owner; `false` means "already gone or not yours". */
export async function deleteBudget(
  userId: string,
  budgetId: string,
): Promise<boolean> {
  const { count } = await getPrisma().budget.deleteMany({
    where: { id: budgetId, userId },
  });

  return count === 1;
}

/**
 * Salary simulation.
 *
 * One options row per owner, one rate change point per (owner, month), one work day per
 * (owner, date): every statement filters on `userId`, and the unique constraints hold
 * those rules at the database level too.
 */

const SALARY_SETTING_SELECT = {
  hoursPerDay: true,
  currency: true,
} as const;

/** Declared structurally, so the mapper does not depend on the generated client type. */
type SalarySettingRow = {
  hoursPerDay: { toString(): string };
  currency: string;
};

function toSalarySettingRecord(row: SalarySettingRow): SalarySettingRecord {
  return {
    // Prisma exposes a numeric type: converting through its string form keeps the value
    // exact and gives the domain a plain decimal.js instance.
    hoursPerDay: new Decimal(row.hoursPerDay.toString()),
    currency: assertCurrency(row.currency),
  };
}

export async function findSalarySetting(
  userId: string,
): Promise<SalarySettingRecord | null> {
  const row = await getPrisma().salarySetting.findUnique({
    where: { userId },
    select: SALARY_SETTING_SELECT,
  });

  return row ? toSalarySettingRecord(row) : null;
}

/**
 * Creates or replaces the owner's simulator options (one row per owner: an upsert).
 * The hourly rate is month-scoped and lives in `SalaryRate`.
 */
export async function upsertSalarySetting(input: {
  userId: string;
  hoursPerDay: Decimal;
  currency: Currency;
}): Promise<void> {
  await getPrisma().salarySetting.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      hoursPerDay: input.hoursPerDay.toFixed(2),
      currency: input.currency,
    },
    update: {
      hoursPerDay: input.hoursPerDay.toFixed(2),
      currency: input.currency,
    },
  });
}

const SALARY_RATE_SELECT = { year: true, month: true, hourlyRate: true } as const;

type SalaryRateRow = {
  year: number;
  month: number;
  hourlyRate: { toString(): string };
};

function toSalaryRateRecord(row: SalaryRateRow): SalaryRateRecord {
  return {
    year: row.year,
    month: row.month,
    hourlyRate: new Decimal(row.hourlyRate.toString()),
  };
}

/**
 * Every rate change point of this owner, oldest first.
 *
 * The table is inherently small (one row per raise), so callers resolve a month in
 * memory with `resolveSalaryRate` instead of asking a second question per month.
 */
export async function listSalaryRates(userId: string): Promise<SalaryRateRecord[]> {
  const rows = await getPrisma().salaryRate.findMany({
    where: { userId },
    orderBy: [{ year: "asc" }, { month: "asc" }],
    select: SALARY_RATE_SELECT,
  });

  return rows.map(toSalaryRateRecord);
}

/**
 * Writes the rate for one month. The unique (owner, year, month) makes it an upsert:
 * saving the same month again corrects its change point instead of piling rows up.
 */
export async function upsertSalaryRate(input: {
  userId: string;
  year: number;
  month: number;
  hourlyRate: Decimal;
}): Promise<void> {
  await getPrisma().salaryRate.upsert({
    where: {
      userId_year_month: {
        userId: input.userId,
        year: input.year,
        month: input.month,
      },
    },
    create: {
      userId: input.userId,
      year: input.year,
      month: input.month,
      hourlyRate: input.hourlyRate.toFixed(2),
    },
    update: { hourlyRate: input.hourlyRate.toFixed(2) },
  });
}

const WORK_DAY_SELECT = { date: true, status: true, hours: true } as const;

type WorkDayRow = {
  date: Date;
  status: string;
  hours: { toString(): string };
};

function toWorkDayRecord(row: WorkDayRow): WorkDayRecord {
  return {
    date: row.date,
    status: row.status as WorkDayStatus,
    hours: new Decimal(row.hours.toString()),
  };
}

/** The work days of a window; the upper bound is exclusive, like every month window. */
export async function listWorkDays(
  userId: string,
  window: { from: Date; to: Date },
): Promise<WorkDayRecord[]> {
  const rows = await getPrisma().workDay.findMany({
    where: { userId, date: { gte: window.from, lt: window.to } },
    orderBy: { date: "asc" },
    select: WORK_DAY_SELECT,
  });

  return rows.map(toWorkDayRecord);
}

export async function findWorkDay(
  userId: string,
  date: Date,
): Promise<WorkDayRecord | null> {
  const row = await getPrisma().workDay.findUnique({
    where: { userId_date: { userId, date } },
    select: WORK_DAY_SELECT,
  });

  return row ? toWorkDayRecord(row) : null;
}

export async function createWorkDay(input: {
  userId: string;
  date: Date;
  status: WorkDayStatus;
  hours: Decimal;
}): Promise<{ id: string }> {
  return getPrisma().workDay.create({
    data: {
      userId: input.userId,
      date: input.date,
      status: input.status,
      hours: input.hours.toFixed(2),
    },
    select: { id: true },
  });
}

/** Partial write by design: the cycle changes the status, an adjustment the hours. */
export async function updateWorkDay(
  userId: string,
  date: Date,
  input: { status?: WorkDayStatus; hours?: Decimal },
): Promise<boolean> {
  const { count } = await getPrisma().workDay.updateMany({
    where: { userId, date },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.hours ? { hours: input.hours.toFixed(2) } : {}),
    },
  });

  return count === 1;
}

/** `false` means "already gone or not yours". */
export async function deleteWorkDay(userId: string, date: Date): Promise<boolean> {
  const { count } = await getPrisma().workDay.deleteMany({ where: { userId, date } });

  return count === 1;
}

/**
 * Recurring forecasts.
 *
 * Definitions describe series; occurrences are their materialised months. Every
 * statement filters on `userId`, and the unique constraints hold the invariants at the
 * database level too: one occurrence per (definition, date), one transaction per
 * confirmation.
 */

const RECURRING_ENTRY_SELECT = {
  id: true,
  accountId: true,
  account: { select: { name: true } },
  categoryId: true,
  category: { select: { name: true } },
  type: true,
  label: true,
  amount: true,
  frequency: true,
  startDate: true,
  endDate: true,
} as const;

/** Declared structurally, so the mapper does not depend on the generated client type. */
type RecurringEntryRow = {
  id: string;
  accountId: string;
  account: { name: string };
  categoryId: string | null;
  category: { name: string } | null;
  type: string;
  label: string;
  amount: { toString(): string };
  frequency: string;
  startDate: Date;
  endDate: Date | null;
};

function toRecurringEntryRecord(row: RecurringEntryRow): RecurringEntryRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    accountName: row.account.name,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    type: row.type as ForecastType,
    label: row.label,
    // Prisma exposes a numeric type: converting through its string form keeps the
    // value exact and gives the domain a plain decimal.js instance.
    amount: new Decimal(row.amount.toString()),
    frequency: row.frequency as RecurrenceFrequency,
    startDate: row.startDate,
    endDate: row.endDate,
  };
}

/** All the owner's definitions, oldest first, so the list reads like a register. */
export async function listRecurringEntries(userId: string): Promise<RecurringEntryRecord[]> {
  const rows = await getPrisma().recurringEntry.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }],
    select: RECURRING_ENTRY_SELECT,
  });

  return rows.map(toRecurringEntryRecord);
}

/** One definition, scoped to its owner; `null` covers foreign and deleted alike. */
export async function findRecurringEntry(
  userId: string,
  entryId: string,
): Promise<RecurringEntryRecord | null> {
  const row = await getPrisma().recurringEntry.findFirst({
    where: { id: entryId, userId },
    select: RECURRING_ENTRY_SELECT,
  });

  return row ? toRecurringEntryRecord(row) : null;
}

export async function createRecurringEntry(input: {
  userId: string;
  accountId: string;
  categoryId: string | null;
  type: ForecastType;
  label: string;
  amount: Decimal;
  frequency: RecurrenceFrequency;
  startDate: Date;
  endDate: Date | null;
}): Promise<{ id: string }> {
  return getPrisma().recurringEntry.create({
    data: {
      userId: input.userId,
      accountId: input.accountId,
      categoryId: input.categoryId,
      type: input.type,
      label: input.label,
      amount: input.amount.toFixed(2),
      frequency: input.frequency,
      startDate: input.startDate,
      endDate: input.endDate,
    },
    select: { id: true },
  });
}

/**
 * Replaces the editable fields of one definition; `false` means "gone or not yours".
 *
 * Existing occurrences are untouched here: the action deletes the *pending* ones when
 * the cadence or the start date moves, so they are re-materialised on the new rule at
 * the next month opening. Decided ones are history and make the action refuse the change.
 */
export async function updateRecurringEntry(
  userId: string,
  entryId: string,
  input: {
    accountId: string;
    categoryId: string | null;
    type: ForecastType;
    label: string;
    amount: Decimal;
    frequency: RecurrenceFrequency;
    startDate: Date;
    endDate: Date | null;
  },
): Promise<boolean> {
  const { count } = await getPrisma().recurringEntry.updateMany({
    where: { id: entryId, userId },
    data: {
      accountId: input.accountId,
      categoryId: input.categoryId,
      type: input.type,
      label: input.label,
      amount: input.amount.toFixed(2),
      frequency: input.frequency,
      startDate: input.startDate,
      endDate: input.endDate,
    },
  });

  return count === 1;
}

/**
 * Deletes the still-pending occurrences of one definition.
 *
 * Called when a series' cadence or start date changes: the pending rows were computed
 * on the old rule, and `ensureRecurringOccurrences` rebuilds them (idempotently, and
 * only for months that are opened afterwards) on the new one. Decided occurrences are
 * deliberately left alone — their dates are an audit trail, which is also why the
 * action refuses the change once one exists.
 */
export async function deletePendingOccurrences(
  userId: string,
  recurringId: string,
): Promise<number> {
  const { count } = await getPrisma().recurringOccurrence.deleteMany({
    where: { userId, recurringId, status: "PENDING" },
  });

  return count;
}

/**
 * How many occurrences of this definition already carry a decision.
 *
 * Deleting a definition is refused while one exists: a skipped or dismissed
 * occurrence is an audit trail, and a confirmation holds the only link to its
 * transaction. Stopping a series is `endDate`'s job, not deletion's.
 */
export async function countDecidedOccurrences(
  userId: string,
  recurringId: string,
): Promise<number> {
  return getPrisma().recurringOccurrence.count({
    where: { userId, recurringId, status: { not: "PENDING" } },
  });
}

/**
 * Deletes one definition. Its *pending* occurrences go with it — they are its own
 * future — while decided ones are protected by `countDecidedOccurrences`.
 * `false` means "already gone or not yours".
 */
export async function deleteRecurringEntry(
  userId: string,
  entryId: string,
): Promise<boolean> {
  const { count } = await getPrisma().recurringEntry.deleteMany({
    where: { id: entryId, userId },
  });

  return count === 1;
}

/**
 * Materialises the month's occurrences for every definition, idempotently.
 *
 * `skipDuplicates` against the unique (recurringId, date) does the whole job: opening
 * the same month twice creates nothing the second time, and a decided occurrence —
 * which still holds its row — is never reset to pending. The dates come from the pure
 * domain (`plannedOccurrences`), not from this layer.
 */
export async function ensureRecurringOccurrences(
  userId: string,
  year: number,
  month: number,
): Promise<void> {
  const entries = await listRecurringEntries(userId);
  const planned = plannedOccurrences(entries, year, month);

  if (planned.length === 0) {
    return;
  }

  await getPrisma().recurringOccurrence.createMany({
    data: planned.map((occurrence) => ({
      userId,
      recurringId: occurrence.recurringId,
      date: occurrence.date,
    })),
    skipDuplicates: true,
  });
}

const RECURRING_OCCURRENCE_SELECT = {
  id: true,
  recurringId: true,
  date: true,
  status: true,
  transactionId: true,
  decidedAt: true,
} as const;

type RecurringOccurrenceRow = {
  id: string;
  recurringId: string;
  date: Date;
  status: string;
  transactionId: string | null;
  decidedAt: Date | null;
};

function toRecurringOccurrenceRecord(
  row: RecurringOccurrenceRow,
): RecurringOccurrenceRecord {
  return {
    id: row.id,
    recurringId: row.recurringId,
    date: row.date,
    status: row.status as RecurringOccurrenceStatus,
    transactionId: row.transactionId,
    decidedAt: row.decidedAt,
  };
}

/** The occurrences of a window, earliest first; the upper bound is exclusive. */
export async function listRecurringOccurrences(
  userId: string,
  window: { from: Date; to: Date },
): Promise<RecurringOccurrenceRecord[]> {
  const rows = await getPrisma().recurringOccurrence.findMany({
    where: { userId, date: { gte: window.from, lt: window.to } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    select: RECURRING_OCCURRENCE_SELECT,
  });

  return rows.map(toRecurringOccurrenceRecord);
}

/** One occurrence, scoped to its owner. */
export async function findRecurringOccurrence(
  userId: string,
  occurrenceId: string,
): Promise<RecurringOccurrenceRecord | null> {
  const row = await getPrisma().recurringOccurrence.findFirst({
    where: { id: occurrenceId, userId },
    select: RECURRING_OCCURRENCE_SELECT,
  });

  return row ? toRecurringOccurrenceRecord(row) : null;
}

/**
 * Records the decision on one pending occurrence.
 *
 * The `PENDING` filter belongs in the `where` clause: a decision is terminal, and two
 * crossed requests must not overwrite each other's state — the loser gets `false` and
 * the action reports it instead of pretending. `transactionId` is only ever set by a
 * confirmation.
 */
export async function decideRecurringOccurrence(
  userId: string,
  occurrenceId: string,
  decision: {
    status: Exclude<RecurringOccurrenceStatus, "PENDING">;
    transactionId?: string;
  },
): Promise<boolean> {
  const { count } = await getPrisma().recurringOccurrence.updateMany({
    where: { id: occurrenceId, userId, status: "PENDING" },
    data: {
      status: decision.status,
      transactionId: decision.transactionId ?? null,
      decidedAt: new Date(),
    },
  });

  return count === 1;
}

/**
 * Goals (BP-04).
 *
 * A goal may link to one account, and every statement filters on the owner: a goal can
 * never read — or point at — another owner's account. The balance of a linked account is
 * the signed sum of its transactions, aggregated in the database rather than summed row
 * by row: an account's balance reads its whole history.
 */

const GOAL_SELECT = {
  id: true,
  name: true,
  targetAmount: true,
  currency: true,
  targetDate: true,
  status: true,
  currentAmount: true,
  accountId: true,
  account: { select: { name: true } },
} as const;

/** Declared structurally, so the mapper does not depend on the generated client type. */
type GoalRow = {
  id: string;
  name: string;
  targetAmount: { toString(): string };
  currency: string;
  targetDate: Date;
  status: string;
  currentAmount: { toString(): string } | null;
  accountId: string | null;
  account: { name: string } | null;
};

function toGoalRecord(row: GoalRow): GoalRecord {
  return {
    id: row.id,
    name: row.name,
    targetAmount: new Decimal(row.targetAmount.toString()),
    currency: assertCurrency(row.currency),
    targetDate: row.targetDate,
    status: row.status as GoalStatus,
    currentAmount:
      row.currentAmount === null ? null : new Decimal(row.currentAmount.toString()),
    accountId: row.accountId,
    accountName: row.account?.name ?? null,
  };
}

/** All the owner's goals, oldest first, so the list reads like a register. */
export async function listGoals(
  userId: string,
  options: { take?: number } = {},
): Promise<GoalRecord[]> {
  const rows = await getPrisma().goal.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }],
    ...(options.take ? { take: options.take } : {}),
    select: GOAL_SELECT,
  });

  return rows.map(toGoalRecord);
}

/** One goal, scoped to its owner; `null` covers foreign and deleted alike. */
export async function findGoal(userId: string, goalId: string): Promise<GoalRecord | null> {
  const row = await getPrisma().goal.findFirst({
    where: { id: goalId, userId },
    select: GOAL_SELECT,
  });

  return row ? toGoalRecord(row) : null;
}

export async function createGoal(input: {
  userId: string;
  name: string;
  targetAmount: Decimal;
  currency: Currency;
  targetDate: Date;
  status: GoalStatus;
  currentAmount: Decimal | null;
  accountId: string | null;
}): Promise<{ id: string }> {
  return getPrisma().goal.create({
    data: {
      userId: input.userId,
      name: input.name,
      targetAmount: input.targetAmount.toFixed(2),
      currency: input.currency,
      targetDate: input.targetDate,
      status: input.status,
      currentAmount: input.currentAmount === null ? null : input.currentAmount.toFixed(2),
      accountId: input.accountId,
    },
    select: { id: true },
  });
}

/** Replaces the editable fields of one goal; `false` means "gone or not yours". */
export async function updateGoal(
  userId: string,
  goalId: string,
  input: {
    name: string;
    targetAmount: Decimal;
    currency: Currency;
    targetDate: Date;
    status: GoalStatus;
    currentAmount: Decimal | null;
    accountId: string | null;
  },
): Promise<boolean> {
  const { count } = await getPrisma().goal.updateMany({
    where: { id: goalId, userId },
    data: {
      name: input.name,
      targetAmount: input.targetAmount.toFixed(2),
      currency: input.currency,
      targetDate: input.targetDate,
      status: input.status,
      currentAmount: input.currentAmount === null ? null : input.currentAmount.toFixed(2),
      accountId: input.accountId,
    },
  });

  return count === 1;
}

/** Deletes one goal of this owner; `false` means "already gone or not yours". */
export async function deleteGoal(userId: string, goalId: string): Promise<boolean> {
  const { count } = await getPrisma().goal.deleteMany({ where: { id: goalId, userId } });

  return count === 1;
}

/*
 * Goal contributions. A contribution is a log entry, never a ledger transaction: it
 * carries its own date and only moves the goal's manual progress.
 */

const GOAL_CONTRIBUTION_SELECT = {
  id: true,
  goalId: true,
  amount: true,
  date: true,
  note: true,
} as const;

type GoalContributionRow = {
  id: string;
  goalId: string;
  amount: { toString(): string };
  date: Date;
  note: string | null;
};

function toGoalContributionRecord(row: GoalContributionRow): GoalContributionRecord {
  return {
    id: row.id,
    goalId: row.goalId,
    // Prisma exposes a numeric type: converting through its string form keeps the value
    // exact and gives the domain a plain decimal.js instance.
    amount: new Decimal(row.amount.toString()),
    date: row.date,
    note: row.note,
  };
}

/** One goal's contributions, most recent first, bounded by `take`. */
export async function listGoalContributions(
  userId: string,
  goalId: string,
  options: { take?: number } = {},
): Promise<GoalContributionRecord[]> {
  const rows = await getPrisma().goalContribution.findMany({
    where: { userId, goalId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    ...(options.take ? { take: options.take } : {}),
    select: GOAL_CONTRIBUTION_SELECT,
  });

  return rows.map(toGoalContributionRecord);
}

/**
 * The owner's contributions across every goal, most recent first, bounded by `take`.
 *
 * One read for the goals screen instead of one query per goal; the exact per-goal
 * counters come from `sumGoalContributions`, so a truncated list never falsifies a
 * total — it only bounds what is displayed.
 */
export async function listGoalContributionsForOwner(
  userId: string,
  options: { take: number },
): Promise<GoalContributionRecord[]> {
  const rows = await getPrisma().goalContribution.findMany({
    where: { userId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: options.take,
    select: GOAL_CONTRIBUTION_SELECT,
  });

  return rows.map(toGoalContributionRecord);
}

/**
 * The contributions of every goal, summed in the database.
 *
 * One grouped read instead of one per goal, and the count travels with the sum so the
 * screen can say "3 contributions" without a second query. A goal absent from the map
 * has no contribution — `null` downstream, never a zero.
 */
export async function sumGoalContributions(
  userId: string,
): Promise<Map<string, { count: number; total: Decimal }>> {
  const rows = await getPrisma().goalContribution.groupBy({
    by: ["goalId"],
    where: { userId },
    _count: { _all: true },
    _sum: { amount: true },
  });

  return new Map(
    rows.map((row) => [
      row.goalId,
      {
        count: row._count._all,
        total: new Decimal(row._sum.amount?.toString() ?? "0"),
      },
    ]),
  );
}

export async function createGoalContribution(input: {
  userId: string;
  goalId: string;
  amount: Decimal;
  date: Date;
  note: string | null;
}): Promise<{ id: string }> {
  return getPrisma().goalContribution.create({
    data: {
      userId: input.userId,
      goalId: input.goalId,
      amount: input.amount.toFixed(2),
      date: input.date,
      note: input.note,
    },
    select: { id: true },
  });
}

/** Deletes one contribution; `false` means "already gone or not yours". */
export async function deleteGoalContribution(
  userId: string,
  contributionId: string,
): Promise<boolean> {
  const { count } = await getPrisma().goalContribution.deleteMany({
    where: { id: contributionId, userId },
  });

  return count === 1;
}

/**
 * The recorded balance of one account: the signed sum of its transactions.
 *
 * The count travels with the sum on purpose — the caller must be able to tell "an
 * account whose movements net to zero" (a real 0,00 €) from "nothing recorded" (an
 * unknown balance), two states the sum alone cannot distinguish.
 */
export async function readAccountBalance(
  userId: string,
  accountId: string,
): Promise<{ transactionCount: number; balance: Decimal }> {
  const result = await getPrisma().transaction.aggregate({
    where: { userId, accountId },
    _count: { _all: true },
    _sum: { amount: true },
  });

  return {
    transactionCount: result._count._all,
    // Prisma types an aggregate as nullable; with no row the sum is zero, and the count
    // is what the caller reads first.
    balance: new Decimal(result._sum.amount?.toString() ?? "0"),
  };
}

/**
 * The recorded balances of every account that has at least one transaction.
 *
 * One aggregate for the whole owner instead of one query per account. An account with
 * no row here has nothing recorded — its balance is **unknown**, which is not a zero,
 * and the caller must say so rather than treat it as one. `lastOperationDate` travels
 * with the balance so the management screen can say since when the account is silent.
 */
export async function listAccountBalanceTotals(
  userId: string,
): Promise<
  {
    accountId: string;
    transactionCount: number;
    balance: Decimal;
    lastOperationDate: Date | null;
  }[]
> {
  const rows = await getPrisma().transaction.groupBy({
    by: ["accountId"],
    where: { userId },
    _count: { _all: true },
    _sum: { amount: true },
    _max: { operationDate: true },
  });

  return rows.map((row) => ({
    accountId: row.accountId,
    transactionCount: row._count._all,
    balance: new Decimal(row._sum.amount?.toString() ?? "0"),
    lastOperationDate: row._max.operationDate ?? null,
  }));
}

/**
 * The signed total of every account, per currency, aggregated in the database.
 *
 * Exists because summing in memory meant reading through the table's page bound: past
 * that bound the "total" would quietly stop being the total. A currency absent from the
 * map has no transaction at all — no row, not a zero. `before` restricts the sum to the
 * operations dated strictly earlier, the starting point of a simulated balance.
 */
export async function sumTransactionsByCurrency(
  userId: string,
  window: { before?: Date } = {},
): Promise<Map<Currency, Decimal>> {
  const rows = await getPrisma().transaction.groupBy({
    by: ["currency"],
    where: {
      userId,
      ...(window.before ? { operationDate: { lt: window.before } } : {}),
    },
    _sum: { amount: true },
  });

  return new Map(
    rows.map((row) => [
      assertCurrency(row.currency),
      new Decimal(row._sum.amount?.toString() ?? "0"),
    ]),
  );
}

/**
 * Candidate rows for the CSV import's duplicate check: the account's existing
 * (date, label, amount) triples and references inside the imported date window.
 *
 * Bounded like a series read: one row more than `take` proves the window was cut, and
 * the import refuses to guess in that case rather than pretend the check ran.
 */
export async function listImportCandidates(input: {
  userId: string;
  accountId: string;
  from: Date;
  to: Date;
  take: number;
}): Promise<
  {
    rows: { operationDate: Date; label: string; amount: Decimal; externalRef: string | null }[];
    truncated: boolean;
  }
> {
  const rows = await getPrisma().transaction.findMany({
    where: {
      userId: input.userId,
      accountId: input.accountId,
      operationDate: { gte: input.from, lt: input.to },
    },
    orderBy: [{ operationDate: "asc" }],
    take: input.take + 1,
    select: { operationDate: true, label: true, amount: true, externalRef: true },
  });

  const truncated = rows.length > input.take;

  return {
    truncated,
    rows: (truncated ? rows.slice(0, input.take) : rows).map((row) => ({
      operationDate: row.operationDate,
      label: row.label,
      amount: new Decimal(row.amount.toString()),
      externalRef: row.externalRef,
    })),
  };
}

/**
 * Copies the budgets of one month onto another, leaving existing rows alone.
 *
 * `skipDuplicates` against the unique (owner, category, month, currency) is what makes
 * the copy safe to replay and what silently keeps a row the owner already adjusted:
 * only genuinely missing envelopes are created, and the counters say how many.
 */
export async function copyBudgets(input: {
  userId: string;
  from: { year: number; month: number };
  to: { year: number; month: number };
}): Promise<{ created: number; skipped: number }> {
  const prisma = getPrisma();
  const source = await prisma.budget.findMany({
    where: { userId: input.userId, year: input.from.year, month: input.from.month },
    select: { categoryId: true, currency: true, amount: true },
  });

  if (source.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const { count } = await prisma.budget.createMany({
    data: source.map((budget) => ({
      userId: input.userId,
      categoryId: budget.categoryId,
      year: input.to.year,
      month: input.to.month,
      currency: budget.currency,
      amount: budget.amount,
    })),
    skipDuplicates: true,
  });

  return { created: count, skipped: source.length - count };
}

/**
 * Bulk write of imported rows.
 *
 * Amounts arrive as exact decimal strings — the parsing already happened in the import
 * module, and re-rounding here could change a cent. `skipDuplicates` leans on the unique
 * (account, externalRef) so a replayed import skips what it already wrote instead of
 * failing whole; the returned count is what was actually inserted.
 */
export async function createImportedTransactions(
  rows: readonly {
    userId: string;
    accountId: string;
    categoryId: string | null;
    type: TransactionType;
    label: string;
    amount: string;
    currency: Currency;
    operationDate: Date;
    notes: string | null;
    externalRef: string | null;
  }[],
): Promise<number> {
  const { count } = await getPrisma().transaction.createMany({
    data: rows.map((row) => ({ ...row })),
    skipDuplicates: true,
  });

  return count;
}

/**
 * The still-pending occurrences of a window, with their definition's account, direction
 * and magnitude — the input of the projected-balance card. Materialised rows only: a
 * month that was never opened has no pending occurrences to project from.
 */
export async function listPendingOccurrenceAmounts(
  userId: string,
  window: { from: Date; to: Date },
): Promise<{ accountId: string; type: ForecastType; amount: Decimal }[]> {
  const rows = await getPrisma().recurringOccurrence.findMany({
    where: {
      userId,
      status: "PENDING",
      date: { gte: window.from, lt: window.to },
    },
    select: {
      recurring: { select: { accountId: true, type: true, amount: true } },
    },
  });

  return rows.map((row) => ({
    accountId: row.recurring.accountId,
    type: row.recurring.type as ForecastType,
    amount: new Decimal(row.recurring.amount.toString()),
  }));
}
