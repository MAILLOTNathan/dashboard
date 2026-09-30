import Decimal from "decimal.js";

/**
 * Exact monetary values.
 *
 * Amounts are never represented with IEEE-754 floats: `Decimal` keeps base-10
 * arithmetic exact, and PostgreSQL stores the same values as `numeric(18, 2)`.
 * A negative amount is an outflow, a positive amount is an inflow.
 */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Amounts are stored with two decimals; more precision is rejected, not rounded silently. */
export const AMOUNT_DECIMALS = 2;

export const DEFAULT_CURRENCY = "EUR";
export const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(value: string): value is Currency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export function assertCurrency(value: string): Currency {
  if (!isSupportedCurrency(value)) {
    throw new Error(
      `Unsupported currency "${value}". Supported currencies: ${SUPPORTED_CURRENCIES.join(", ")}.`,
    );
  }
  return value;
}

export type Money = {
  readonly amount: Decimal;
  readonly currency: Currency;
};

export function money(
  amount: Decimal.Value,
  currency: Currency = DEFAULT_CURRENCY,
): Money {
  return { amount: new Decimal(amount), currency };
}

export function zeroMoney(currency: Currency = DEFAULT_CURRENCY): Money {
  return money(0, currency);
}

/**
 * Adds amounts of a single currency.
 *
 * Mixing currencies would silently produce a meaningless total, so a mismatch
 * throws instead of guessing an exchange rate.
 */
export function sumMoney(values: readonly Money[], currency?: Currency): Money {
  const target = currency ?? values[0]?.currency ?? DEFAULT_CURRENCY;
  let total = new Decimal(0);

  for (const value of values) {
    if (value.currency !== target) {
      throw new Error(
        `Cannot sum ${value.currency} and ${target}: convert to a common currency first.`,
      );
    }
    total = total.plus(value.amount);
  }

  return { amount: total, currency: target };
}

/**
 * Formats an amount for display. Display only: never feed the result back into
 * a calculation.
 */
export function formatMoney(
  value: Money,
  options: { locale?: string } = {},
): string {
  return new Intl.NumberFormat(options.locale ?? "fr-FR", {
    style: "currency",
    currency: value.currency,
    minimumFractionDigits: AMOUNT_DECIMALS,
    maximumFractionDigits: AMOUNT_DECIMALS,
  }).format(value.amount.toNumber());
}

/** Serialises an amount for persistence or CSV export. */
export function toDecimalString(value: Decimal): string {
  return value.toFixed(AMOUNT_DECIMALS);
}

export class InvalidAmountError extends Error {
  constructor(readonly input: string, reason: string) {
    super(`Invalid amount "${input}": ${reason}`);
    this.name = "InvalidAmountError";
  }
}

const AMOUNT_PATTERN = new RegExp(`^[+-]?\\d+\\.\\d{1,${AMOUNT_DECIMALS}}$|^[+-]?\\d+$`);

/**
 * Parses a hand-typed amount.
 *
 * Accepted: `12`, `12,50`, `12.50`, `-45,90`, `1 234,56`, `1.234,56`, `12,50 €`.
 * A comma is the decimal separator. When both separators are present, `.` is
 * treated as a thousands separator. More than two decimals is an error rather
 * than a silent rounding.
 */
export function parseAmountInput(raw: string): Decimal {
  const withoutCurrency = raw
    .replace(/[\s\u00A0\u202F]/g, "")
    .replace(/[€$£]/g, "");

  if (withoutCurrency === "" || withoutCurrency === "-" || withoutCurrency === "+") {
    throw new InvalidAmountError(raw, "no digits found");
  }

  let normalized = withoutCurrency;
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }

  if (!AMOUNT_PATTERN.test(normalized)) {
    throw new InvalidAmountError(
      raw,
      `expected a number with at most ${AMOUNT_DECIMALS} decimals`,
    );
  }

  // decimal.js accepts a leading minus but not a leading plus.
  return new Decimal(normalized.startsWith("+") ? normalized.slice(1) : normalized);
}
