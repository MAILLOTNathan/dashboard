import Decimal from "decimal.js";
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
import type { SalarySettingRecord, WorkDayRecord, WorkDayStatus } from "./salary";
import {
  plannedOccurrences,
  type ForecastType,
  type RecurrenceFrequency,
  type RecurringEntryRecord,
  type RecurringOccurrenceRecord,
  type RecurringOccurrenceStatus,
} from "./recurrence";
import type { GoalRecord, GoalStatus } from "./goals";
import type { LabelUsage } from "./suggestions";

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
    createdAt: row.createdAt,
  };
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

export async function countTransactions(userId: string): Promise<number> {
  return getPrisma().transaction.count({ where: { userId } });
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
 * One setting per owner, one work day per (owner, date): every statement filters on
 * `userId`, and the unique constraints hold those rules at the database level too.
 */

const SALARY_SETTING_SELECT = {
  hourlyRate: true,
  hoursPerDay: true,
  currency: true,
} as const;

/** Declared structurally, so the mapper does not depend on the generated client type. */
type SalarySettingRow = {
  hourlyRate: { toString(): string };
  hoursPerDay: { toString(): string };
  currency: string;
};

function toSalarySettingRecord(row: SalarySettingRow): SalarySettingRecord {
  return {
    // Prisma exposes a numeric type: converting through its string form keeps the value
    // exact and gives the domain a plain decimal.js instance.
    hourlyRate: new Decimal(row.hourlyRate.toString()),
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

/** Creates or replaces the owner's wage. One setting per owner: the form is an upsert. */
export async function upsertSalarySetting(input: {
  userId: string;
  hourlyRate: Decimal;
  hoursPerDay: Decimal;
  currency: Currency;
}): Promise<void> {
  await getPrisma().salarySetting.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      hourlyRate: input.hourlyRate.toFixed(2),
      hoursPerDay: input.hoursPerDay.toFixed(2),
      currency: input.currency,
    },
    update: {
      hourlyRate: input.hourlyRate.toFixed(2),
      hoursPerDay: input.hoursPerDay.toFixed(2),
      currency: input.currency,
    },
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
export async function listGoals(userId: string): Promise<GoalRecord[]> {
  const rows = await getPrisma().goal.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }],
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
 * and the caller must say so rather than treat it as one.
 */
export async function listAccountBalanceTotals(
  userId: string,
): Promise<{ accountId: string; transactionCount: number; balance: Decimal }[]> {
  const rows = await getPrisma().transaction.groupBy({
    by: ["accountId"],
    where: { userId },
    _count: { _all: true },
    _sum: { amount: true },
  });

  return rows.map((row) => ({
    accountId: row.accountId,
    transactionCount: row._count._all,
    balance: new Decimal(row._sum.amount?.toString() ?? "0"),
  }));
}
