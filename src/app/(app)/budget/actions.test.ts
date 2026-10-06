import Decimal from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const deleteTransactionMock = vi.fn();
const createTransactionMock = vi.fn();
const updateTransactionMock = vi.fn();
const findAccountMock = vi.fn();
const findCategoryMock = vi.fn();
const findBudgetByPeriodMock = vi.fn();
const createBudgetMock = vi.fn();
const updateBudgetMock = vi.fn();
const deleteBudgetMock = vi.fn();
const findSalarySettingMock = vi.fn();
const upsertSalarySettingMock = vi.fn();
const listWorkDaysMock = vi.fn();
const findWorkDayMock = vi.fn();
const createWorkDayMock = vi.fn();
const updateWorkDayMock = vi.fn();
const deleteWorkDayMock = vi.fn();
const ensureCategoryMock = vi.fn();
const findTransactionByExternalRefMock = vi.fn();
const findCashflowLinkedToTransactionMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/auth/guard", () => ({ requireUser: () => requireUserMock() }));
vi.mock("@/modules/budget/repository", () => ({
  deleteTransaction: (...args: unknown[]) => deleteTransactionMock(...args),
  createTransaction: (...args: unknown[]) => createTransactionMock(...args),
  updateTransaction: (...args: unknown[]) => updateTransactionMock(...args),
  findAccount: (...args: unknown[]) => findAccountMock(...args),
  findCategory: (...args: unknown[]) => findCategoryMock(...args),
  findBudgetByPeriod: (...args: unknown[]) => findBudgetByPeriodMock(...args),
  createBudget: (...args: unknown[]) => createBudgetMock(...args),
  updateBudget: (...args: unknown[]) => updateBudgetMock(...args),
  deleteBudget: (...args: unknown[]) => deleteBudgetMock(...args),
  findSalarySetting: (...args: unknown[]) => findSalarySettingMock(...args),
  upsertSalarySetting: (...args: unknown[]) => upsertSalarySettingMock(...args),
  listWorkDays: (...args: unknown[]) => listWorkDaysMock(...args),
  findWorkDay: (...args: unknown[]) => findWorkDayMock(...args),
  createWorkDay: (...args: unknown[]) => createWorkDayMock(...args),
  updateWorkDay: (...args: unknown[]) => updateWorkDayMock(...args),
  deleteWorkDay: (...args: unknown[]) => deleteWorkDayMock(...args),
  ensureCategory: (...args: unknown[]) => ensureCategoryMock(...args),
  findTransactionByExternalRef: (...args: unknown[]) =>
    findTransactionByExternalRefMock(...args),
  createAccount: vi.fn(),
  createCategory: vi.fn(),
}));
vi.mock("@/modules/real-estate/repository", () => ({
  findCashflowLinkedToTransaction: (...args: unknown[]) =>
    findCashflowLinkedToTransactionMock(...args),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

const {
  adjustWorkDayHoursAction,
  bookSalaryAction,
  createBudgetAction,
  createTransactionAction,
  cycleWorkDayAction,
  deleteBudgetAction,
  deleteTransactionAction,
  saveSalarySettingAction,
  updateBudgetAction,
  updateTransactionAction,
} = await import("./actions");

/**
 * Fictitious data only. The action is the only place that decides whether a deletion
 * is allowed, so it is tested against mocked repositories: no test touches a database.
 */
const OWNER = { id: "owner-1", email: "owner@example.test", name: null };

describe("deleteTransactionAction", () => {
  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(OWNER);
    deleteTransactionMock.mockReset().mockResolvedValue(true);
    findCashflowLinkedToTransactionMock.mockReset().mockResolvedValue(null);
    revalidatePathMock.mockReset();
  });

  it("deletes the transaction of the signed-in owner and refreshes the pages", async () => {
    const result = await deleteTransactionAction({ id: "tx-1" });

    expect(result).toEqual({ status: "ok" });
    // The owner is always part of the query: a foreign identifier matches nothing.
    expect(deleteTransactionMock).toHaveBeenCalledWith(OWNER.id, "tx-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/budget");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
  });

  it("refuses to delete a transaction a property cashflow is linked to", async () => {
    findCashflowLinkedToTransactionMock.mockResolvedValue({
      id: "cashflow-1",
      propertyName: "Appartement de test",
    });

    const result = await deleteTransactionAction({ id: "tx-1" });

    expect(result.status).toBe("invalid");
    // The message must name the property: that is what makes it actionable.
    expect(result.status === "invalid" && result.message).toContain("Appartement de test");
    // And nothing is deleted: the cashflow would be left with no amount at all.
    expect(deleteTransactionMock).not.toHaveBeenCalled();
  });

  it("reports an unknown or already deleted transaction instead of pretending", async () => {
    deleteTransactionMock.mockResolvedValue(false);

    const result = await deleteTransactionAction({ id: "tx-gone" });

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/introuvable/);
  });

  it("rejects a payload without an identifier", async () => {
    const result = await deleteTransactionAction({ id: "   " });

    expect(result.status).toBe("invalid");
    expect(deleteTransactionMock).not.toHaveBeenCalled();
  });

  it("answers with a generic message when the database fails", async () => {
    deleteTransactionMock.mockRejectedValue(new Error("connection lost"));

    const result = await deleteTransactionAction({ id: "tx-1" });

    expect(result).toEqual({
      status: "error",
      message: "Enregistrement impossible pour le moment. Réessayez dans un instant.",
    });
  });

  it("checks the session before touching anything", async () => {
    requireUserMock.mockRejectedValue(new Error("redirect:/login"));

    await expect(deleteTransactionAction({ id: "tx-1" })).rejects.toThrow("redirect:/login");
    expect(deleteTransactionMock).not.toHaveBeenCalled();
  });
});

/** Fictitious rows only. */
const ACCOUNT = {
  id: "account-1",
  name: "Compte courant",
  type: "CHECKING" as const,
  // Deliberately not the default currency: the form cannot send one, so asserting a value
  // other than EUR proves the currency is read from the account rather than defaulted.
  currency: "USD" as const,
};
const CATEGORY = { id: "category-1", name: "Courses", kind: "EXPENSE" as const };

const VALID_FORM = {
  accountId: ACCOUNT.id,
  categoryId: CATEGORY.id,
  type: "EXPENSE" as const,
  label: "Courses du samedi",
  amount: "-45,90",
  operationDate: "2026-09-30",
  notes: "",
};

describe("createTransactionAction", () => {
  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(OWNER);
    findAccountMock.mockReset().mockResolvedValue(ACCOUNT);
    findCategoryMock.mockReset().mockResolvedValue(CATEGORY);
    createTransactionMock.mockReset().mockResolvedValue({ id: "tx-1" });
    updateTransactionMock.mockReset().mockResolvedValue(true);
    revalidatePathMock.mockReset();
  });

  it("stores the row with the currency of its account, scoped to the owner", async () => {
    const result = await createTransactionAction(VALID_FORM);

    expect(result).toEqual({ status: "ok" });
    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const [input] = createTransactionMock.mock.calls[0] as [Record<string, unknown>];

    expect(input).toMatchObject({
      userId: OWNER.id,
      accountId: ACCOUNT.id,
      categoryId: CATEGORY.id,
      type: "EXPENSE",
      label: "Courses du samedi",
      currency: ACCOUNT.currency,
      externalRef: null,
    });
    // The typed string became an exact decimal before it reached persistence.
    expect((input.amount as { toFixed(scale: number): string }).toFixed(2)).toBe("-45.90");
    expect(revalidatePathMock).toHaveBeenCalledWith("/budget");
  });

  it("refuses an account that is not the owner's", async () => {
    findAccountMock.mockResolvedValue(null);

    const result = await createTransactionAction(VALID_FORM);

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.fieldErrors.accountId).toHaveLength(1);
    expect(createTransactionMock).not.toHaveBeenCalled();
  });
});

describe("updateTransactionAction", () => {
  const validUpdate = { ...VALID_FORM, id: "tx-1" };

  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(OWNER);
    findAccountMock.mockReset().mockResolvedValue(ACCOUNT);
    findCategoryMock.mockReset().mockResolvedValue(CATEGORY);
    createTransactionMock.mockReset().mockResolvedValue({ id: "tx-1" });
    updateTransactionMock.mockReset().mockResolvedValue(true);
    revalidatePathMock.mockReset();
  });

  it("replaces every editable field of the owner's own row", async () => {
    const result = await updateTransactionAction({
      ...validUpdate,
      label: "Courses corrigées",
      type: "TRANSFER",
      categoryId: "",
      amount: "120,00",
    });

    expect(result).toEqual({ status: "ok" });
    expect(updateTransactionMock).toHaveBeenCalledTimes(1);

    const [userId, transactionId, write] = updateTransactionMock.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];

    // The owner is always part of the query: a foreign identifier matches no row.
    expect(userId).toBe(OWNER.id);
    expect(transactionId).toBe("tx-1");
    expect(write).toMatchObject({
      accountId: ACCOUNT.id,
      // An unselected category is stored as null, not as an empty string.
      categoryId: null,
      type: "TRANSFER",
      label: "Courses corrigées",
      currency: ACCOUNT.currency,
    });
    expect((write.amount as { toFixed(scale: number): string }).toFixed(2)).toBe("120.00");
    expect(revalidatePathMock).toHaveBeenCalledWith("/budget");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
  });

  it("never sends an external reference: a corrected import stays an import", async () => {
    await updateTransactionAction(validUpdate);

    const [, , write] = updateTransactionMock.mock.calls[0] as [string, string, object];

    expect(write).not.toHaveProperty("externalRef");
  });

  it("refuses an account that is not the owner's", async () => {
    findAccountMock.mockResolvedValue(null);

    const result = await updateTransactionAction(validUpdate);

    expect(result.status).toBe("invalid");
    expect(updateTransactionMock).not.toHaveBeenCalled();
  });

  it("refuses a category whose kind contradicts the type", async () => {
    findCategoryMock.mockResolvedValue({ id: "category-2", name: "Salaire", kind: "INCOME" });

    const result = await updateTransactionAction(validUpdate);

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.fieldErrors.categoryId).toHaveLength(1);
    expect(updateTransactionMock).not.toHaveBeenCalled();
  });

  it("applies the sign rule shared with the creation", async () => {
    const negativeIncome = { ...validUpdate, type: "INCOME" as const, amount: "-10,00" };

    const created = await createTransactionAction(negativeIncome);
    const updated = await updateTransactionAction(negativeIncome);

    // One resolver, two callers: neither can accept what the other refuses.
    expect(created.status).toBe("invalid");
    expect(updated.status).toBe("invalid");
    expect(createTransactionMock).not.toHaveBeenCalled();
    expect(updateTransactionMock).not.toHaveBeenCalled();
  });

  it("reports a row that matched nothing instead of answering success", async () => {
    updateTransactionMock.mockResolvedValue(false);

    const result = await updateTransactionAction(validUpdate);

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/introuvable/);
    // Nothing was written, so the page must not be told the data changed.
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects a payload without an identifier before reading anything", async () => {
    const result = await updateTransactionAction({ ...VALID_FORM, id: "" });

    expect(result.status).toBe("invalid");
    expect(findAccountMock).not.toHaveBeenCalled();
    expect(updateTransactionMock).not.toHaveBeenCalled();
  });

  it("answers with a generic message when the database fails", async () => {
    updateTransactionMock.mockRejectedValue(new Error("connection lost"));

    const result = await updateTransactionAction(validUpdate);

    expect(result).toEqual({
      status: "error",
      message: "Enregistrement impossible pour le moment. Réessayez dans un instant.",
    });
  });

  it("checks the session before touching anything", async () => {
    requireUserMock.mockRejectedValue(new Error("redirect:/login"));

    await expect(updateTransactionAction(validUpdate)).rejects.toThrow("redirect:/login");
    expect(updateTransactionMock).not.toHaveBeenCalled();
  });
});

/** Fictitious rows only. */
const BUDGET_CATEGORY = { id: "category-1", name: "Courses", kind: "EXPENSE" as const };
const VALID_BUDGET = {
  categoryId: BUDGET_CATEGORY.id,
  month: "2026-10",
  currency: "EUR",
  amount: "300,00",
};

describe("createBudgetAction", () => {
  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(OWNER);
    findCategoryMock.mockReset().mockResolvedValue(BUDGET_CATEGORY);
    findBudgetByPeriodMock.mockReset().mockResolvedValue(null);
    createBudgetMock.mockReset().mockResolvedValue({ id: "budget-1" });
    revalidatePathMock.mockReset();
  });

  it("stores a positive plan for the owner's own category", async () => {
    const result = await createBudgetAction(VALID_BUDGET);

    expect(result).toEqual({ status: "ok" });
    expect(createBudgetMock).toHaveBeenCalledTimes(1);

    const [input] = createBudgetMock.mock.calls[0] as [Record<string, unknown>];

    expect(input).toMatchObject({
      userId: OWNER.id,
      categoryId: BUDGET_CATEGORY.id,
      year: 2026,
      month: 10,
      currency: "EUR",
    });
    // The typed string became an exact decimal before it reached persistence.
    expect((input.amount as { toFixed(scale: number): string }).toFixed(2)).toBe("300.00");
    expect(revalidatePathMock).toHaveBeenCalledWith("/budget");
  });

  it("ignores a posted owner instead of trusting it", async () => {
    await createBudgetAction({ ...VALID_BUDGET, userId: "someone-else" });

    const [input] = createBudgetMock.mock.calls[0] as [Record<string, unknown>];

    expect(input.userId).toBe(OWNER.id);
  });

  it("keeps EUR and USD apart: the same month carries one budget per currency", async () => {
    const euros = await createBudgetAction(VALID_BUDGET);
    const dollars = await createBudgetAction({
      ...VALID_BUDGET,
      currency: "USD",
      amount: "350,00",
    });

    expect(euros).toEqual({ status: "ok" });
    expect(dollars).toEqual({ status: "ok" });

    const currencies = createBudgetMock.mock.calls.map(
      ([input]) => (input as { currency: string }).currency,
    );
    expect(currencies).toEqual(["EUR", "USD"]);
    // The duplicate check asked about each currency separately, not about the month alone.
    expect(findBudgetByPeriodMock).toHaveBeenNthCalledWith(
      2,
      OWNER.id,
      expect.objectContaining({ currency: "USD" }),
    );
  });

  it("refuses a duplicate month for the same category and currency", async () => {
    findBudgetByPeriodMock.mockResolvedValue({
      id: "budget-existing",
      categoryId: BUDGET_CATEGORY.id,
      year: 2026,
      month: 10,
      currency: "EUR",
    });

    const result = await createBudgetAction(VALID_BUDGET);

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/existe déjà/);
    expect(createBudgetMock).not.toHaveBeenCalled();
  });

  it("turns the database's own uniqueness refusal into the same message", async () => {
    // The pre-check is not a race guard: two requests can cross between the read and
    // the write, and the unique index is what refuses the second one.
    createBudgetMock.mockRejectedValue({ code: "P2002" });

    const result = await createBudgetAction(VALID_BUDGET);

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/existe déjà/);
  });

  it("refuses a category that is not the owner's", async () => {
    findCategoryMock.mockResolvedValue(null);

    const result = await createBudgetAction(VALID_BUDGET);

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.fieldErrors.categoryId).toHaveLength(1);
    expect(findBudgetByPeriodMock).not.toHaveBeenCalled();
    expect(createBudgetMock).not.toHaveBeenCalled();
  });

  it("refuses an amount that is not a strictly positive number", async () => {
    for (const amount of ["0", "-10,00", "trois cents"]) {
      const result = await createBudgetAction({ ...VALID_BUDGET, amount });

      expect(result.status).toBe("invalid");
    }

    expect(findCategoryMock).not.toHaveBeenCalled();
    expect(createBudgetMock).not.toHaveBeenCalled();
  });

  it("refuses an unsupported currency before reading anything", async () => {
    const result = await createBudgetAction({ ...VALID_BUDGET, currency: "XYZ" });

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/invalides/);
    expect(findCategoryMock).not.toHaveBeenCalled();
    expect(createBudgetMock).not.toHaveBeenCalled();
  });

  it("rejects a month outside the calendar bounds", async () => {
    const result = await createBudgetAction({ ...VALID_BUDGET, month: "2026-13" });

    expect(result.status).toBe("invalid");
    expect(findCategoryMock).not.toHaveBeenCalled();
    expect(createBudgetMock).not.toHaveBeenCalled();
  });

  it("answers with a generic message when the database fails", async () => {
    createBudgetMock.mockRejectedValue(new Error("connection lost"));

    const result = await createBudgetAction(VALID_BUDGET);

    expect(result).toEqual({
      status: "error",
      message: "Enregistrement impossible pour le moment. Réessayez dans un instant.",
    });
  });

  it("checks the session before touching anything", async () => {
    requireUserMock.mockRejectedValue(new Error("redirect:/login"));

    await expect(createBudgetAction(VALID_BUDGET)).rejects.toThrow("redirect:/login");
    expect(findCategoryMock).not.toHaveBeenCalled();
    expect(createBudgetMock).not.toHaveBeenCalled();
  });
});

describe("updateBudgetAction", () => {
  const validUpdate = { ...VALID_BUDGET, id: "budget-1" };

  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(OWNER);
    findCategoryMock.mockReset().mockResolvedValue(BUDGET_CATEGORY);
    findBudgetByPeriodMock.mockReset().mockResolvedValue(null);
    updateBudgetMock.mockReset().mockResolvedValue(true);
    revalidatePathMock.mockReset();
  });

  it("replaces the editable fields of the owner's own row", async () => {
    const result = await updateBudgetAction({ ...validUpdate, amount: "320,00" });

    expect(result).toEqual({ status: "ok" });

    const [userId, budgetId, write] = updateBudgetMock.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];

    // The owner is always part of the query: a foreign identifier matches no row.
    expect(userId).toBe(OWNER.id);
    expect(budgetId).toBe("budget-1");
    expect(write).toMatchObject({
      categoryId: BUDGET_CATEGORY.id,
      year: 2026,
      month: 10,
      currency: "EUR",
    });
    expect((write.amount as { toFixed(scale: number): string }).toFixed(2)).toBe("320.00");
    expect(revalidatePathMock).toHaveBeenCalledWith("/budget");
  });

  it("does not treat the row being edited as a duplicate of itself", async () => {
    findBudgetByPeriodMock.mockResolvedValue({
      id: "budget-1",
      categoryId: BUDGET_CATEGORY.id,
      year: 2026,
      month: 10,
      currency: "EUR",
    });

    const result = await updateBudgetAction(validUpdate);

    expect(result).toEqual({ status: "ok" });
    expect(updateBudgetMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to move the row onto another budget of the same period", async () => {
    findBudgetByPeriodMock.mockResolvedValue({
      id: "budget-existing",
      categoryId: BUDGET_CATEGORY.id,
      year: 2026,
      month: 10,
      currency: "EUR",
    });

    const result = await updateBudgetAction(validUpdate);

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/existe déjà/);
    expect(updateBudgetMock).not.toHaveBeenCalled();
  });

  it("refuses a category that is not the owner's", async () => {
    findCategoryMock.mockResolvedValue(null);

    const result = await updateBudgetAction(validUpdate);

    expect(result.status).toBe("invalid");
    expect(updateBudgetMock).not.toHaveBeenCalled();
  });

  it("reports a row that matched nothing instead of answering success", async () => {
    updateBudgetMock.mockResolvedValue(false);

    const result = await updateBudgetAction(validUpdate);

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/introuvable/);
    // Nothing was written, so the page must not be told the data changed.
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects a payload without an identifier before reading anything", async () => {
    const result = await updateBudgetAction({ ...VALID_BUDGET, id: "" });

    expect(result.status).toBe("invalid");
    expect(findCategoryMock).not.toHaveBeenCalled();
    expect(updateBudgetMock).not.toHaveBeenCalled();
  });

  it("checks the session before touching anything", async () => {
    requireUserMock.mockRejectedValue(new Error("redirect:/login"));

    await expect(updateBudgetAction(validUpdate)).rejects.toThrow("redirect:/login");
    expect(updateBudgetMock).not.toHaveBeenCalled();
  });
});

describe("deleteBudgetAction", () => {
  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(OWNER);
    deleteBudgetMock.mockReset().mockResolvedValue(true);
    revalidatePathMock.mockReset();
  });

  it("deletes the budget of the signed-in owner and refreshes the page", async () => {
    const result = await deleteBudgetAction({ id: "budget-1" });

    expect(result).toEqual({ status: "ok" });
    // The owner is always part of the query: a foreign identifier matches nothing.
    expect(deleteBudgetMock).toHaveBeenCalledWith(OWNER.id, "budget-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/budget");
  });

  it("reports an unknown or already deleted budget instead of pretending", async () => {
    deleteBudgetMock.mockResolvedValue(false);

    const result = await deleteBudgetAction({ id: "budget-gone" });

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/introuvable/);
  });

  it("rejects a payload without an identifier", async () => {
    const result = await deleteBudgetAction({ id: "   " });

    expect(result.status).toBe("invalid");
    expect(deleteBudgetMock).not.toHaveBeenCalled();
  });

  it("answers with a generic message when the database fails", async () => {
    deleteBudgetMock.mockRejectedValue(new Error("connection lost"));

    const result = await deleteBudgetAction({ id: "budget-1" });

    expect(result).toEqual({
      status: "error",
      message: "Enregistrement impossible pour le moment. Réessayez dans un instant.",
    });
  });

  it("checks the session before touching anything", async () => {
    requireUserMock.mockRejectedValue(new Error("redirect:/login"));

    await expect(deleteBudgetAction({ id: "budget-1" })).rejects.toThrow("redirect:/login");
    expect(deleteBudgetMock).not.toHaveBeenCalled();
  });
});

/** Fictitious salary data only. */
const SALARY_SETTING = {
  hourlyRate: new Decimal("20.50"),
  hoursPerDay: new Decimal("7.5"),
  currency: "EUR" as const,
};
const WORK_DATE = new Date("2026-10-05T00:00:00.000Z");

describe("saveSalarySettingAction", () => {
  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(OWNER);
    upsertSalarySettingMock.mockReset().mockResolvedValue(undefined);
    revalidatePathMock.mockReset();
  });

  it("stores the rate and the day length for the signed-in owner", async () => {
    const result = await saveSalarySettingAction({
      hourlyRate: "20,50",
      hoursPerDay: "7,5",
      currency: "EUR",
    });

    expect(result).toEqual({ status: "ok" });
    expect(upsertSalarySettingMock).toHaveBeenCalledTimes(1);

    const [input] = upsertSalarySettingMock.mock.calls[0] as [Record<string, unknown>];

    expect(input.userId).toBe(OWNER.id);
    expect(input.currency).toBe("EUR");
    // The typed strings became exact decimals before they reached persistence.
    expect((input.hourlyRate as { toFixed(scale: number): string }).toFixed(2)).toBe(
      "20.50",
    );
    expect((input.hoursPerDay as { toFixed(scale: number): string }).toFixed(2)).toBe(
      "7.50",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/budget");
  });

  it("refuses a rate that is not strictly positive, before writing", async () => {
    for (const hourlyRate of ["0", "-1", "vingt"]) {
      const result = await saveSalarySettingAction({
        hourlyRate,
        hoursPerDay: "7",
        currency: "EUR",
      });

      expect(result.status).toBe("invalid");
    }

    expect(upsertSalarySettingMock).not.toHaveBeenCalled();
  });

  it("refuses an implausible day length", async () => {
    const result = await saveSalarySettingAction({
      hourlyRate: "20",
      hoursPerDay: "25",
      currency: "EUR",
    });

    expect(result.status).toBe("invalid");
    expect(upsertSalarySettingMock).not.toHaveBeenCalled();
  });

  it("checks the session before touching anything", async () => {
    requireUserMock.mockRejectedValue(new Error("redirect:/login"));

    await expect(
      saveSalarySettingAction({ hourlyRate: "20", hoursPerDay: "7", currency: "EUR" }),
    ).rejects.toThrow("redirect:/login");
    expect(upsertSalarySettingMock).not.toHaveBeenCalled();
  });

  it("answers with a generic message when the database fails", async () => {
    upsertSalarySettingMock.mockRejectedValue(new Error("connection lost"));

    const result = await saveSalarySettingAction({
      hourlyRate: "20",
      hoursPerDay: "7",
      currency: "EUR",
    });

    expect(result).toEqual({
      status: "error",
      message: "Enregistrement impossible pour le moment. Réessayez dans un instant.",
    });
  });
});

describe("cycleWorkDayAction", () => {
  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(OWNER);
    findSalarySettingMock.mockReset().mockResolvedValue(SALARY_SETTING);
    findWorkDayMock.mockReset().mockResolvedValue(null);
    createWorkDayMock.mockReset().mockResolvedValue({ id: "work-day-1" });
    updateWorkDayMock.mockReset().mockResolvedValue(true);
    deleteWorkDayMock.mockReset().mockResolvedValue(true);
    revalidatePathMock.mockReset();
  });

  it("plans a day on the first click, with the configured day length", async () => {
    const result = await cycleWorkDayAction({ date: "2026-10-05" });

    expect(result).toEqual({ status: "ok" });
    expect(createWorkDayMock).toHaveBeenCalledTimes(1);

    const [input] = createWorkDayMock.mock.calls[0] as [Record<string, unknown>];

    // The owner is always part of the query, and the day length is copied onto the row.
    expect(input.userId).toBe(OWNER.id);
    expect(input.status).toBe("PLANNED");
    expect((input.date as Date).toISOString()).toBe(WORK_DATE.toISOString());
    expect((input.hours as { toFixed(scale: number): string }).toFixed(2)).toBe("7.50");
    expect(revalidatePathMock).toHaveBeenCalledWith("/budget");
  });

  it("turns a planned day into a worked day on the second click", async () => {
    findWorkDayMock.mockResolvedValue({
      date: WORK_DATE,
      status: "PLANNED",
      hours: new Decimal("7.5"),
    });

    const result = await cycleWorkDayAction({ date: "2026-10-05" });

    expect(result).toEqual({ status: "ok" });
    expect(updateWorkDayMock).toHaveBeenCalledWith(OWNER.id, WORK_DATE, {
      status: "WORKED",
    });
    // The hours are untouched by a status change.
    const [, , write] = updateWorkDayMock.mock.calls[0] as [string, Date, Record<string, unknown>];
    expect(write).not.toHaveProperty("hours");
  });

  it("removes the day on the third click", async () => {
    findWorkDayMock.mockResolvedValue({
      date: WORK_DATE,
      status: "WORKED",
      hours: new Decimal("8"),
    });

    const result = await cycleWorkDayAction({ date: "2026-10-05" });

    expect(result).toEqual({ status: "ok" });
    expect(deleteWorkDayMock).toHaveBeenCalledWith(OWNER.id, WORK_DATE);
    expect(createWorkDayMock).not.toHaveBeenCalled();
  });

  it("refuses a click before a rate exists, without writing anything", async () => {
    findSalarySettingMock.mockResolvedValue(null);

    const result = await cycleWorkDayAction({ date: "2026-10-05" });

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/taux horaire/);
    expect(createWorkDayMock).not.toHaveBeenCalled();
    expect(updateWorkDayMock).not.toHaveBeenCalled();
    expect(deleteWorkDayMock).not.toHaveBeenCalled();
  });

  it("rejects an impossible date before reading anything", async () => {
    const result = await cycleWorkDayAction({ date: "2026-02-31" });

    expect(result.status).toBe("invalid");
    expect(findSalarySettingMock).not.toHaveBeenCalled();
    expect(createWorkDayMock).not.toHaveBeenCalled();
  });

  it("checks the session before touching anything", async () => {
    requireUserMock.mockRejectedValue(new Error("redirect:/login"));

    await expect(cycleWorkDayAction({ date: "2026-10-05" })).rejects.toThrow(
      "redirect:/login",
    );
    expect(createWorkDayMock).not.toHaveBeenCalled();
  });

  it("answers with a generic message when the database fails", async () => {
    createWorkDayMock.mockRejectedValue(new Error("connection lost"));

    const result = await cycleWorkDayAction({ date: "2026-10-05" });

    expect(result).toEqual({
      status: "error",
      message: "Enregistrement impossible pour le moment. Réessayez dans un instant.",
    });
  });
});

describe("adjustWorkDayHoursAction", () => {
  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(OWNER);
    findWorkDayMock.mockReset().mockResolvedValue({
      date: WORK_DATE,
      status: "PLANNED",
      hours: new Decimal("7.5"),
    });
    updateWorkDayMock.mockReset().mockResolvedValue(true);
    revalidatePathMock.mockReset();
  });

  it("adds half an hour to the owner's own day", async () => {
    const result = await adjustWorkDayHoursAction({
      date: "2026-10-05",
      direction: "UP",
    });

    expect(result).toEqual({ status: "ok" });
    expect(updateWorkDayMock).toHaveBeenCalledTimes(1);

    const [userId, date, write] = updateWorkDayMock.mock.calls[0] as [
      string,
      Date,
      Record<string, unknown>,
    ];

    expect(userId).toBe(OWNER.id);
    expect(date.toISOString()).toBe(WORK_DATE.toISOString());
    expect((write.hours as { toFixed(scale: number): string }).toFixed(2)).toBe("8.00");
    // An hours write must not move the status.
    expect(write).not.toHaveProperty("status");
  });

  it("removes half an hour", async () => {
    await adjustWorkDayHoursAction({ date: "2026-10-05", direction: "DOWN" });

    const [, , write] = updateWorkDayMock.mock.calls[0] as [string, Date, Record<string, unknown>];

    expect((write.hours as { toFixed(scale: number): string }).toFixed(2)).toBe("7.00");
  });

  it("stays at the lower bound without writing", async () => {
    findWorkDayMock.mockResolvedValue({
      date: WORK_DATE,
      status: "WORKED",
      hours: new Decimal("0.5"),
    });

    const result = await adjustWorkDayHoursAction({
      date: "2026-10-05",
      direction: "DOWN",
    });

    expect(result).toEqual({ status: "ok" });
    expect(updateWorkDayMock).not.toHaveBeenCalled();
  });

  it("reports a day that is no longer clicked", async () => {
    findWorkDayMock.mockResolvedValue(null);

    const result = await adjustWorkDayHoursAction({
      date: "2026-10-05",
      direction: "UP",
    });

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/rechargez/);
    expect(updateWorkDayMock).not.toHaveBeenCalled();
  });

  it("rejects a direction that is not up or down", async () => {
    const result = await adjustWorkDayHoursAction({
      date: "2026-10-05",
      direction: "SIDEWAYS",
    });

    expect(result.status).toBe("invalid");
    expect(findWorkDayMock).not.toHaveBeenCalled();
    expect(updateWorkDayMock).not.toHaveBeenCalled();
  });

  it("checks the session before touching anything", async () => {
    requireUserMock.mockRejectedValue(new Error("redirect:/login"));

    await expect(
      adjustWorkDayHoursAction({ date: "2026-10-05", direction: "UP" }),
    ).rejects.toThrow("redirect:/login");
    expect(updateWorkDayMock).not.toHaveBeenCalled();
  });
});

/** Fictitious booking data only. */
const EUR_ACCOUNT = {
  id: "account-eur",
  name: "Compte courant",
  type: "CHECKING" as const,
  currency: "EUR" as const,
};
const SALARY_CATEGORY = { id: "category-salary", name: "Salaire", kind: "INCOME" as const };
const BOOKING = { month: "2026-10", accountId: EUR_ACCOUNT.id, date: "2026-10-31" };

describe("bookSalaryAction", () => {
  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(OWNER);
    findSalarySettingMock.mockReset().mockResolvedValue(SALARY_SETTING);
    findAccountMock.mockReset().mockResolvedValue(EUR_ACCOUNT);
    findTransactionByExternalRefMock.mockReset().mockResolvedValue(null);
    listWorkDaysMock.mockReset().mockResolvedValue([
      { date: WORK_DATE, status: "WORKED", hours: new Decimal("8") },
      {
        date: new Date("2026-10-06T00:00:00.000Z"),
        status: "PLANNED",
        hours: new Decimal("7.5"),
      },
    ]);
    ensureCategoryMock.mockReset().mockResolvedValue(SALARY_CATEGORY);
    createTransactionMock.mockReset().mockResolvedValue({ id: "tx-salary" });
    revalidatePathMock.mockReset();
  });

  it("books the worked amount as an income in the « Salaire » category", async () => {
    const result = await bookSalaryAction(BOOKING);

    expect(result).toEqual({ status: "ok" });

    // The default category is ensured owner-scoped: created if the owner has none.
    expect(ensureCategoryMock).toHaveBeenCalledWith({
      userId: OWNER.id,
      name: "Salaire",
      kind: "INCOME",
    });

    const [input] = createTransactionMock.mock.calls[0] as [Record<string, unknown>];

    expect(input).toMatchObject({
      userId: OWNER.id,
      accountId: EUR_ACCOUNT.id,
      categoryId: SALARY_CATEGORY.id,
      type: "INCOME",
      label: "Salaire octobre 2026",
      currency: "EUR",
      notes: null,
      // The stable reference is what makes a second booking of the month impossible.
      externalRef: "salary:2026-10",
    });
    // 8 worked hours × 20.50: the planned day is not booked.
    expect((input.amount as { toFixed(scale: number): string }).toFixed(2)).toBe("164.00");
    expect((input.operationDate as Date).toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(revalidatePathMock).toHaveBeenCalledWith("/budget");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
  });

  it("refuses a month without a worked day", async () => {
    listWorkDaysMock.mockResolvedValue([
      { date: WORK_DATE, status: "PLANNED", hours: new Decimal("7.5") },
    ]);

    const result = await bookSalaryAction(BOOKING);

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/rien à enregistrer/);
    expect(ensureCategoryMock).not.toHaveBeenCalled();
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it("refuses an account in another currency instead of converting", async () => {
    // The shared ACCOUNT fixture is deliberately in USD.
    findAccountMock.mockResolvedValue(ACCOUNT);

    const result = await bookSalaryAction(BOOKING);

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/devise/);
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it("refuses an account that is not the owner's", async () => {
    findAccountMock.mockResolvedValue(null);

    const result = await bookSalaryAction(BOOKING);

    expect(result.status).toBe("invalid");
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it("refuses to book before a rate exists", async () => {
    findSalarySettingMock.mockResolvedValue(null);

    const result = await bookSalaryAction(BOOKING);

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/taux horaire/);
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it("refuses a month that is already booked", async () => {
    findTransactionByExternalRefMock.mockResolvedValue({ id: "tx-existing" });

    const result = await bookSalaryAction(BOOKING);

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/déjà enregistrée/);
    // The reference identifies the booking, not a label the owner may have edited.
    expect(findTransactionByExternalRefMock).toHaveBeenCalledWith(OWNER.id, "salary:2026-10");
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it("turns the database's own uniqueness refusal into the same message", async () => {
    createTransactionMock.mockRejectedValue({ code: "P2002" });

    const result = await bookSalaryAction(BOOKING);

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.message).toMatch(/déjà enregistrée/);
  });

  it("rejects an impossible payload before reading anything", async () => {
    const result = await bookSalaryAction({ ...BOOKING, date: "2026-02-31" });

    expect(result.status).toBe("invalid");
    expect(findSalarySettingMock).not.toHaveBeenCalled();
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it("checks the session before touching anything", async () => {
    requireUserMock.mockRejectedValue(new Error("redirect:/login"));

    await expect(bookSalaryAction(BOOKING)).rejects.toThrow("redirect:/login");
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it("answers with a generic message when the database fails", async () => {
    createTransactionMock.mockRejectedValue(new Error("connection lost"));

    const result = await bookSalaryAction(BOOKING);

    expect(result).toEqual({
      status: "error",
      message: "Enregistrement impossible pour le moment. Réessayez dans un instant.",
    });
  });
});
