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
