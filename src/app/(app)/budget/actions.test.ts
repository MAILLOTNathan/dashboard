import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const deleteTransactionMock = vi.fn();
const createTransactionMock = vi.fn();
const updateTransactionMock = vi.fn();
const findAccountMock = vi.fn();
const findCategoryMock = vi.fn();
const findCashflowLinkedToTransactionMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/auth/guard", () => ({ requireUser: () => requireUserMock() }));
vi.mock("@/modules/budget/repository", () => ({
  deleteTransaction: (...args: unknown[]) => deleteTransactionMock(...args),
  createTransaction: (...args: unknown[]) => createTransactionMock(...args),
  updateTransaction: (...args: unknown[]) => updateTransactionMock(...args),
  findAccount: (...args: unknown[]) => findAccountMock(...args),
  findCategory: (...args: unknown[]) => findCategoryMock(...args),
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

const { createTransactionAction, deleteTransactionAction, updateTransactionAction } =
  await import("./actions");

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
