import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  accountInputSchema,
  assertAmountMatchesType,
  budgetIdentityKey,
  budgetInputSchema,
  budgetMonthKey,
  budgetUpdateSchema,
  categoryInputSchema,
  categoryKindForTransactionType,
  categoryMismatchReason,
  findDuplicateBudget,
  toBudgetFormInitialValues,
  toTransactionFormInitialValues,
  transactionFormSchema,
  transactionUpdateSchema,
  type BudgetRecord,
  type TransactionRecord,
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

describe("transactionUpdateSchema", () => {
  const validUpdate = {
    id: "transaction-1",
    accountId: "account-1",
    categoryId: "category-1",
    type: "EXPENSE",
    label: "Courses",
    amount: "-45,90",
    operationDate: "2026-09-30",
    notes: "",
  };

  it("parses an edition exactly like a creation", () => {
    const result = transactionUpdateSchema.safeParse(validUpdate);

    expect(result.success).toBe(true);
    expect(result.data?.amount.toFixed(2)).toBe("-45.90");
    expect(result.data?.operationDate.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(result.data?.id).toBe("transaction-1");
  });

  it("requires the identifier of the row", () => {
    expect(transactionUpdateSchema.safeParse({ ...validUpdate, id: "   " }).success).toBe(
      false,
    );

    // Built without the key at all, which is what a hand-written request that omits it
    // looks like to the parser.
    expect(
      transactionUpdateSchema.safeParse({
        accountId: validUpdate.accountId,
        categoryId: validUpdate.categoryId,
        type: validUpdate.type,
        label: validUpdate.label,
        amount: validUpdate.amount,
        operationDate: validUpdate.operationDate,
        notes: validUpdate.notes,
      }).success,
    ).toBe(false);
  });

  it("inherits the creation rules rather than restating them", () => {
    // Two contracts that drifted apart is exactly how an edition ends up accepting what
    // a creation refuses, so the rules are asserted on both.
    const tooPrecise = { ...validUpdate, amount: "12,345" };
    const withoutAccount = { ...validUpdate, accountId: "" };

    expect(transactionUpdateSchema.safeParse(tooPrecise).success).toBe(false);
    expect(transactionUpdateSchema.safeParse(withoutAccount).success).toBe(false);
    expect(transactionFormSchema.safeParse(tooPrecise).success).toBe(false);
  });

  it("carries no currency and no owner, even when one is posted", () => {
    // The owner comes from the session and the currency from the account: sending either
    // one must not survive validation, or a replayed request could choose its owner.
    const result = transactionUpdateSchema.safeParse({
      ...validUpdate,
      currency: "USD",
      userId: "someone-else",
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("currency");
    expect(result.data).not.toHaveProperty("userId");
  });
});

describe("toTransactionFormInitialValues", () => {
  const record: TransactionRecord = {
    id: "transaction-1",
    type: "EXPENSE",
    amount: new Decimal("-45.90"),
    currency: "EUR",
    operationDate: new Date("2026-09-30T00:00:00.000Z"),
    label: "Courses",
    accountId: "account-1",
    accountName: "Compte courant",
    categoryId: "category-1",
    categoryName: "Courses",
    notes: null,
    externalRef: null,
    transferGroupId: null,
    reconciledAt: null,
    createdAt: new Date("2026-09-30T00:00:00.000Z"),
  };

  it("hands the form strings only, never a Decimal or a Date", () => {
    const values = toTransactionFormInitialValues(record);

    // This is the regression test for a real failure: a Decimal instance cannot cross the
    // server/client boundary, so the client received an object whose methods were gone and
    // the form crashed on `value.toFixed is not a function`.
    for (const value of Object.values(values)) {
      expect(typeof value).toBe("string");
    }

    expect(values.amount).toBe("-45.90");
    expect(values.operationDate).toBe("2026-09-30");
  });

  it("turns an unset category and absent notes into empty fields", () => {
    const values = toTransactionFormInitialValues({
      ...record,
      categoryId: null,
      notes: null,
    });

    expect(values.categoryId).toBe("");
    expect(values.notes).toBe("");
  });

  it("round-trips through the form's own schema without moving a cent", () => {
    const parsed = transactionFormSchema.safeParse(toTransactionFormInitialValues(record));

    expect(parsed.success).toBe(true);
    expect(parsed.data?.amount.toFixed(2)).toBe("-45.90");
  });
});

describe("categoryKindForTransactionType", () => {
  it("pairs an income with income categories", () => {
    expect(categoryKindForTransactionType("INCOME")).toBe("INCOME");
  });

  it("pairs an expense with expense categories", () => {
    expect(categoryKindForTransactionType("EXPENSE")).toBe("EXPENSE");
  });

  it("leaves a transfer without a category", () => {
    // A transfer moves money between two of your own accounts: it is neither a
    // receipt nor a cost, and it is already excluded from the monthly totals.
    expect(categoryKindForTransactionType("TRANSFER")).toBeNull();
  });
});

describe("categoryMismatchReason", () => {
  const expenseCategory = { kind: "EXPENSE" } as const;
  const incomeCategory = { kind: "INCOME" } as const;

  it("accepts a category of the matching kind", () => {
    expect(categoryMismatchReason("EXPENSE", expenseCategory)).toBeNull();
    expect(categoryMismatchReason("INCOME", incomeCategory)).toBeNull();
  });

  it("always accepts no category at all: a category is optional", () => {
    expect(categoryMismatchReason("EXPENSE", null)).toBeNull();
    expect(categoryMismatchReason("INCOME", null)).toBeNull();
    // The usual case for a transfer between two of your own accounts.
    expect(categoryMismatchReason("TRANSFER", null)).toBeNull();
  });

  it("refuses an income category on an expense, and the reverse", () => {
    expect(categoryMismatchReason("EXPENSE", incomeCategory)).toMatch(/même type/);
    expect(categoryMismatchReason("INCOME", expenseCategory)).toMatch(/même type/);
  });

  it("refuses any category on a transfer", () => {
    expect(categoryMismatchReason("TRANSFER", expenseCategory)).toMatch(
      /transfert entre comptes ne porte pas de catégorie/,
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

describe("budgetInputSchema", () => {
  /** Fictitious values only. */
  const validBudget = {
    categoryId: "category-1",
    month: "2026-10",
    currency: "EUR",
    amount: "300,00",
  };

  it("parses a month into the two integers the model stores", () => {
    const result = budgetInputSchema.safeParse(validBudget);

    expect(result.success).toBe(true);
    // Exactly the stored contract: no bounds or dates travel along with the month.
    expect(result.data?.month).toEqual({ year: 2026, month: 10 });
  });

  it("parses a hand-typed amount into an exact decimal", () => {
    const result = budgetInputSchema.safeParse({ ...validBudget, amount: "1 234,56" });

    expect(result.success).toBe(true);
    expect(result.data?.amount.toFixed(2)).toBe("1234.56");
  });

  it("refuses a plan that is not strictly positive", () => {
    // The absence of a budget is the absence of a row: zero says nothing.
    expect(budgetInputSchema.safeParse({ ...validBudget, amount: "0" }).success).toBe(false);
    expect(budgetInputSchema.safeParse({ ...validBudget, amount: "-10,00" }).success).toBe(
      false,
    );
  });

  it("refuses an invalid amount rather than rounding it", () => {
    expect(budgetInputSchema.safeParse({ ...validBudget, amount: "12,345" }).success).toBe(
      false,
    );
    expect(budgetInputSchema.safeParse({ ...validBudget, amount: "trois cents" }).success).toBe(
      false,
    );
  });

  it("refuses a month outside the calendar bounds", () => {
    for (const month of ["2026-13", "2026-00", "1969-12", "10-2026", "2026-10-01"]) {
      expect(budgetInputSchema.safeParse({ ...validBudget, month }).success, month).toBe(
        false,
      );
    }

    expect(budgetInputSchema.safeParse({ ...validBudget, month: "2026-01" }).success).toBe(
      true,
    );
  });

  it("refuses an unsupported currency and a missing category", () => {
    const wrongCurrency = budgetInputSchema.safeParse({ ...validBudget, currency: "XYZ" });

    expect(wrongCurrency.success).toBe(false);
    expect(wrongCurrency.error?.issues[0]?.message).toBe("Devise non prise en charge.");
    expect(budgetInputSchema.safeParse({ ...validBudget, categoryId: "" }).success).toBe(false);
  });

  it("keeps the currencies of the same month apart", () => {
    const euros = budgetInputSchema.parse(validBudget);
    const dollars = budgetInputSchema.parse({ ...validBudget, currency: "USD" });

    expect(euros.currency).toBe("EUR");
    expect(dollars.currency).toBe("USD");
  });
});

describe("budgetUpdateSchema", () => {
  const validBudget = {
    categoryId: "category-1",
    month: "2026-10",
    currency: "EUR",
    amount: "300,00",
  };

  it("parses an edition like a creation, plus the row identifier", () => {
    const result = budgetUpdateSchema.safeParse({ ...validBudget, id: "budget-1" });

    expect(result.success).toBe(true);
    expect(result.data?.id).toBe("budget-1");
    expect(result.data?.amount.toFixed(2)).toBe("300.00");
  });

  it("requires the identifier of the row", () => {
    expect(budgetUpdateSchema.safeParse({ ...validBudget, id: "   " }).success).toBe(false);
  });

  it("inherits the creation rules rather than restating them", () => {
    // Two contracts that drifted apart is how an edition ends up accepting what a
    // creation refuses, so the rules are asserted on both.
    const zeroPlan = { ...validBudget, amount: "0" };

    expect(budgetUpdateSchema.safeParse({ ...zeroPlan, id: "budget-1" }).success).toBe(false);
    expect(budgetInputSchema.safeParse(zeroPlan).success).toBe(false);
  });

  it("carries no owner, even when one is posted", () => {
    const result = budgetUpdateSchema.safeParse({
      ...validBudget,
      id: "budget-1",
      userId: "someone-else",
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("userId");
  });
});

describe("budget identity", () => {
  const identity = { categoryId: "category-1", year: 2026, month: 10, currency: "EUR" as const };

  it("keys one month the way the rest of the project writes it", () => {
    expect(budgetMonthKey(2026, 10)).toBe("2026-10");
    expect(budgetMonthKey(2026, 1)).toBe("2026-01");
  });

  it("gives the same identity to the same category, month and currency", () => {
    expect(budgetIdentityKey(identity)).toBe(budgetIdentityKey({ ...identity }));
  });

  it("keeps another currency, category or month distinct", () => {
    // Currency separation: EUR and USD are two budgets, not a duplicate.
    expect(budgetIdentityKey({ ...identity, currency: "USD" })).not.toBe(
      budgetIdentityKey(identity),
    );
    expect(budgetIdentityKey({ ...identity, categoryId: "category-2" })).not.toBe(
      budgetIdentityKey(identity),
    );
    expect(budgetIdentityKey({ ...identity, month: 11 })).not.toBe(budgetIdentityKey(identity));
  });

  it("finds the duplicate row of the same period, and no other", () => {
    const existing = [
      { id: "budget-usd", categoryId: "category-1", year: 2026, month: 10, currency: "USD" as const },
    ];

    expect(findDuplicateBudget(identity, existing)).toBeNull();
    expect(
      findDuplicateBudget({ ...identity, currency: "USD" }, existing)?.id,
    ).toBe("budget-usd");
  });

  it("finds nothing in an empty month", () => {
    expect(findDuplicateBudget(identity, [])).toBeNull();
  });
});

describe("toBudgetFormInitialValues", () => {
  /** Fictitious row only. */
  const record: BudgetRecord = {
    id: "budget-1",
    categoryId: "category-1",
    categoryName: "Courses",
    categoryKind: "EXPENSE",
    year: 2026,
    month: 10,
    currency: "EUR",
    amount: new Decimal("300.00"),
  };

  it("hands the form strings only, never a Decimal", () => {
    const values = toBudgetFormInitialValues(record);

    // Same boundary rule as the transaction form: a Decimal cannot cross into a client
    // component, and a month input only understands `YYYY-MM`.
    for (const value of Object.values(values)) {
      expect(typeof value).toBe("string");
    }

    expect(values.month).toBe("2026-10");
    expect(values.amount).toBe("300.00");
  });

  it("round-trips through the module's own schema without moving a cent", () => {
    const parsed = budgetInputSchema.safeParse(toBudgetFormInitialValues(record));

    expect(parsed.success).toBe(true);
    expect(parsed.data?.amount.toFixed(2)).toBe("300.00");
    expect(parsed.data?.month).toEqual({ year: 2026, month: 10 });
  });
});
