import { z } from "zod";
import { parseDateOnly } from "@/lib/dates";
import { assertCurrency, parseAmountInput } from "@/lib/money";

/**
 * Field helpers shared by the module input contracts.
 *
 * The same schema validates in the browser (through react-hook-form) and on the
 * server, so every message is written for the user, in French.
 *
 * Two HTML conventions are handled here: an empty input is sent as `""` (not as
 * a missing value), and an unselected `<select>` as `""` too, so optional fields
 * normalise `""` to `null` before any business rule sees them.
 *
 * A validation failure is always reported with `ctx.addIssue` rather than thrown:
 * a throwing transform escapes `safeParse` and surfaces as a crash instead of a
 * field error, in the browser as well as on the server.
 */

const DATE_MESSAGE = "Date attendue au format AAAA-MM-JJ.";

/** Optional free text: trimmed, `""` becomes null. */
export function optionalText(max: number, message: string) {
  return z
    .string()
    .trim()
    .max(max, message)
    .nullish()
    .transform((value) => (value === null || value === undefined || value === "" ? null : value));
}

/** Optional identifier coming from a `<select>`: `""` means "nothing selected". */
export const optionalId = z
  .string()
  .trim()
  .nullish()
  .transform((value) => (value === null || value === undefined || value === "" ? null : value));

/** A required `YYYY-MM-DD` field, converted to a calendar day at UTC midnight. */
export const requiredDate = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      return parseDateOnly(value);
    } catch {
      ctx.addIssue({ code: "custom", message: DATE_MESSAGE });
      return z.NEVER;
    }
  });

/** An optional `YYYY-MM-DD` field: empty becomes null, otherwise a calendar day. */
export const optionalDate = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    try {
      return parseDateOnly(value);
    } catch {
      ctx.addIssue({ code: "custom", message: DATE_MESSAGE });
      return z.NEVER;
    }
  });

/** A currency code, checked against the supported list. */
export const currencyCode = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      return assertCurrency(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Devise non prise en charge." });
      return z.NEVER;
    }
  });

const AMOUNT_MESSAGE = "Montant invalide. Exemples acceptés : 12,50, 1 234,56 ou -45,90.";

/**
 * A hand-typed amount, converted to an exact decimal. Never a float: see
 * `lib/money.ts` for the accepted formats and the two-decimal limit.
 */
export const amount = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      return parseAmountInput(value);
    } catch {
      ctx.addIssue({ code: "custom", message: AMOUNT_MESSAGE });
      return z.NEVER;
    }
  });

/** Same as `amount`, but an empty field means "no amount" rather than an error. */
export const optionalAmount = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    try {
      return parseAmountInput(value);
    } catch {
      ctx.addIssue({ code: "custom", message: AMOUNT_MESSAGE });
      return z.NEVER;
    }
  });
