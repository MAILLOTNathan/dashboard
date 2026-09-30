import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const deleteTransactionMock = vi.fn();
const findCashflowLinkedToTransactionMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/auth/guard", () => ({ requireUser: () => requireUserMock() }));
vi.mock("@/modules/budget/repository", () => ({
  deleteTransaction: (...args: unknown[]) => deleteTransactionMock(...args),
  createAccount: vi.fn(),
  createCategory: vi.fn(),
  createTransaction: vi.fn(),
  findAccount: vi.fn(),
  findCategory: vi.fn(),
}));
vi.mock("@/modules/real-estate/repository", () => ({
  findCashflowLinkedToTransaction: (...args: unknown[]) =>
    findCashflowLinkedToTransactionMock(...args),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

const { deleteTransactionAction } = await import("./actions");

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
