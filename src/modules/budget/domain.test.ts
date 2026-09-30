import { describe, expect, it } from "vitest";
import {
  accountInputSchema,
  assertAmountMatchesType,
  categoryInputSchema,
  transactionFormSchema,
  type TransactionType,
} from "./domain";

/** Fictitious values only: never a real transaction in a fixture. */

describe("accountInputSchema", () => {
  it("accepts a manually tracked account", () => {
    const result = accountInputSchema.safeParse({
      name: "Compte courant",
      type: "CHECKING",
      currency: "EUR",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an unsupported currency with a readable message", () => {
    const result = accountInputSchema.safeParse({
      name: "Compte courant",
      type: "CHECKING",
      currency: "XYZ",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Devise non prise en charge.");
  });

  it("rejects a blank name", () => {
    const result = accountInputSchema.safeParse({ name: "   ", type: "CASH", currency: "EUR" });

    expect(result.success).toBe(false);
  });
});

describe("categoryInputSchema", () => {
  it("accepts an expense category", () => {
    expect(
      categoryInputSchema.safeParse({ name: "Travaux", kind: "EXPENSE" }).success,
    ).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(
      categoryInputSchema.safeParse({ name: "Travaux", kind: "SAVINGS" }).success,
    ).toBe(false);
  });
});

describe("transactionFormSchema", () => {
  const validForm = {
    accountId: "account-1",
    categoryId: "category-1",
    type: "EXPENSE",
    label: "Courses",
    amount: "-45,90",
    operationDate: "2026-09-30",
    notes: "",
  };

  it("parses a hand-typed French amount into an exact decimal", () => {
    const result = transactionFormSchema.safeParse(validForm);

    expect(result.success).toBe(true);
    expect(result.data?.amount.toFixed(2)).toBe("-45.90");
  });

  it("accepts thousands separators and a leading plus", () => {
    const result = transactionFormSchema.safeParse({
      ...validForm,
      type: "INCOME",
      amount: "1 234,56",
    });

    expect(result.data?.amount.toFixed(2)).toBe("1234.56");
  });

  it("turns a date-only field into a calendar day at UTC midnight", () => {
    const result = transactionFormSchema.safeParse(validForm);

    expect(result.data?.operationDate.toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("rejects an impossible calendar day instead of shifting it", () => {
    const result = transactionFormSchema.safeParse({
      ...validForm,
      operationDate: "2026-02-31",
    });

    expect(result.success).toBe(false);
  });

  it("turns an unselected category and empty notes into null", () => {
    const result = transactionFormSchema.safeParse({
      ...validForm,
      categoryId: "",
      notes: "   ",
    });

    expect(result.data?.categoryId).toBeNull();
    expect(result.data?.notes).toBeNull();
  });

  it("carries no currency: the account decides it", () => {
    const result = transactionFormSchema.safeParse(validForm);

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("currency");
  });

  it("rejects an amount with more than two decimals rather than rounding it", () => {
    expect(
      transactionFormSchema.safeParse({ ...validForm, amount: "12,345" }).success,
    ).toBe(false);
  });

  it("rejects a missing account", () => {
    expect(transactionFormSchema.safeParse({ ...validForm, accountId: "" }).success).toBe(
      false,
    );
  });
});

describe("assertAmountMatchesType", () => {
  /** The sign is part of the meaning, so it is validated, not silently corrected. */
  function parseAmount(amount: string, type: TransactionType) {
    return transactionFormSchema.parse({
      accountId: "account-1",
      categoryId: "",
      type,
      label: "Ligne de test",
      amount,
      operationDate: "2026-09-30",
      notes: "",
    }).amount;
  }

  it("refuses a negative income", () => {
    expect(() => assertAmountMatchesType(parseAmount("-900,00", "INCOME"), "INCOME")).toThrow(
      /recette doit être positive/,
    );
  });

  it("allows a positive amount on an expense: a reimbursement", () => {
    expect(() =>
      assertAmountMatchesType(parseAmount("35,00", "EXPENSE"), "EXPENSE"),
    ).not.toThrow();
  });

  it("refuses a zero expense", () => {
    expect(() => assertAmountMatchesType(parseAmount("0", "EXPENSE"), "EXPENSE")).toThrow(
      /dépense de zéro/,
    );
  });
});
