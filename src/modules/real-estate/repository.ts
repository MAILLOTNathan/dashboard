import Decimal from "decimal.js";
import { getPrisma } from "@/lib/db";
import { assertCurrency, type Currency } from "@/lib/money";
import {
  computePropertyTotals,
  type CashflowEntry,
  type CashflowKind,
  type PropertyOccupancy,
  type PropertySummary,
} from "./domain";
import type { DueCashflow } from "./alerts";

/** Real-estate persistence. Every query is scoped to the owner. */

export async function listProperties(userId: string): Promise<PropertySummary[]> {
  const rows = await getPrisma().property.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      address: true,
      occupancy: true,
      purchaseDate: true,
      saleDate: true,
      notes: true,
      cashflows: {
        select: {
          id: true,
          kind: true,
          label: true,
          currency: true,
          amount: true,
          dueDate: true,
          settledAt: true,
          transaction: { select: { id: true, label: true, amount: true } },
        },
      },
    },
  });

  return rows.map((row) => {
    const entries: CashflowEntry[] = row.cashflows.map((cashflow) => ({
      id: cashflow.id,
      kind: cashflow.kind as CashflowKind,
      label: cashflow.label,
      currency: assertCurrency(cashflow.currency),
      // `null` means "linked to a transaction": see the double-counting rule.
      amount: cashflow.amount ? new Decimal(cashflow.amount.toString()) : null,
      dueDate: cashflow.dueDate,
      settledAt: cashflow.settledAt,
      transaction: cashflow.transaction
        ? {
            id: cashflow.transaction.id,
            label: cashflow.transaction.label,
            amount: new Decimal(cashflow.transaction.amount.toString()),
          }
        : null,
    }));

    const currency: Currency = entries[0]?.currency ?? "EUR";
    const totals = computePropertyTotals(entries, { currency });

    return {
      id: row.id,
      name: row.name,
      address: row.address,
      occupancy: row.occupancy as PropertyOccupancy,
      purchaseDate: row.purchaseDate,
      saleDate: row.saleDate,
      notes: row.notes,
      cashflowCount: entries.length,
      income: totals.income,
      expenses: totals.expenses,
      net: totals.net,
      currency,
    } satisfies PropertySummary;
  });
}

export async function countProperties(userId: string): Promise<number> {
  return getPrisma().property.count({ where: { userId } });
}

/**
 * The property cashflow that links to a transaction, if any.
 *
 * Used before deleting a transaction. The schema declares that relation as
 * `onDelete: SetNull`, which would leave the cashflow with **neither** a linked
 * transaction nor an amount of its own — the one state `resolveCashflowAmount`
 * refuses, and which would break the property totals of this owner. So the deletion
 * is refused instead, and the caller can name the property to fix.
 */
export async function findCashflowLinkedToTransaction(
  userId: string,
  transactionId: string,
): Promise<{ id: string; propertyName: string } | null> {
  const row = await getPrisma().propertyCashflow.findFirst({
    where: { transactionId, property: { userId } },
    select: { id: true, property: { select: { name: true } } },
  });

  return row ? { id: row.id, propertyName: row.property.name } : null;
}

/** Owner-scoped property lookup: a form identifier is never trusted. */
export async function findProperty(
  userId: string,
  propertyId: string,
): Promise<{ id: string; name: string } | null> {
  const row = await getPrisma().property.findFirst({
    where: { id: propertyId, userId },
    select: { id: true, name: true },
  });

  return row;
}

export async function createProperty(input: {
  userId: string;
  name: string;
  address: string | null;
  occupancy: PropertyOccupancy;
  purchaseDate: Date | null;
  saleDate: Date | null;
  notes: string | null;
}): Promise<{ id: string }> {
  return getPrisma().property.create({
    data: {
      userId: input.userId,
      name: input.name.trim(),
      address: input.address,
      occupancy: input.occupancy,
      purchaseDate: input.purchaseDate,
      saleDate: input.saleDate,
      notes: input.notes,
    },
    select: { id: true },
  });
}

/**
 * Creates a cashflow entry.
 *
 * `transactionId` and `amount` are mutually exclusive, as enforced by
 * `cashflowInputSchema`; the database also rejects a second entry linked to the
 * same transaction.
 */
export async function createCashflow(input: {
  propertyId: string;
  kind: CashflowKind;
  label: string;
  amount: Decimal | null;
  transactionId: string | null;
  currency: Currency;
  dueDate: Date | null;
  settledAt: Date | null;
  notes: string | null;
}): Promise<{ id: string }> {
  return getPrisma().propertyCashflow.create({
    data: {
      propertyId: input.propertyId,
      kind: input.kind,
      label: input.label.trim(),
      amount: input.amount ? input.amount.toFixed(2) : null,
      transactionId: input.transactionId,
      currency: input.currency,
      dueDate: input.dueDate,
      settledAt: input.settledAt,
      notes: input.notes,
    },
    select: { id: true },
  });
}

/**
 * Unsettled cashflows whose due date has arrived, for the overdue alert rule.
 *
 * The owner filter goes through the property (`PropertyCashflow` carries no `userId` of
 * its own), the query is bounded to due dates up to `until`, and the rule re-checks the
 * overdue condition itself — this read only narrows the rows. The amount is resolved
 * here the way totals resolve it (entry amount, else linked transaction), and stays
 * `null` when neither exists: the rule then reports "unknown", never zero.
 */
export async function listDueCashflows(
  userId: string,
  options: { until?: Date } = {},
): Promise<DueCashflow[]> {
  const until = options.until ?? new Date();

  const rows = await getPrisma().propertyCashflow.findMany({
    where: {
      property: { userId },
      settledAt: null,
      dueDate: { not: null, lte: until },
    },
    orderBy: { dueDate: "asc" },
    select: {
      id: true,
      kind: true,
      label: true,
      currency: true,
      amount: true,
      dueDate: true,
      settledAt: true,
      property: { select: { id: true, name: true } },
      transaction: { select: { amount: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    propertyId: row.property.id,
    propertyName: row.property.name,
    label: row.label,
    kind: row.kind as CashflowKind,
    currency: assertCurrency(row.currency),
    amount: row.amount
      ? new Decimal(row.amount.toString())
      : row.transaction
        ? new Decimal(row.transaction.amount.toString())
        : null,
    dueDate: row.dueDate,
    settledAt: row.settledAt,
  }));
}
