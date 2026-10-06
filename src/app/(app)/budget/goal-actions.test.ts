import Decimal from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const findAccountMock = vi.fn();
const createGoalMock = vi.fn();
const updateGoalMock = vi.fn();
const deleteGoalMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/auth/guard", () => ({ requireUser: () => requireUserMock() }));
vi.mock("@/modules/budget/repository", () => ({
  findAccount: (...args: unknown[]) => findAccountMock(...args),
  createGoal: (...args: unknown[]) => createGoalMock(...args),
  updateGoal: (...args: unknown[]) => updateGoalMock(...args),
  deleteGoal: (...args: unknown[]) => deleteGoalMock(...args),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

const { createGoalAction, updateGoalAction, deleteGoalAction } = await import("./goal-actions");

/**
 * Fictitious data only. These actions decide alone whether a write is allowed, so they
 * are exercised against mocked repositories: no test touches a database. What is
 * asserted here is the protection itself — every goal is written for the signed-in
 * owner, a linked account must be one of that owner's, in the goal's currency, and a
 * refusal writes nothing.
 */
const OWNER = { id: "owner-1", email: "owner@example.test", name: null };

const ACCOUNT = { id: "account-1", name: "Compte courant", type: "CHECKING", currency: "EUR" };
const ACCOUNT_USD = { id: "account-2", name: "Compte dollars", type: "SAVINGS", currency: "USD" };

const VALID_PAYLOAD = {
  name: "Apport immobilier",
  targetAmount: "1 000",
  currency: "EUR",
  targetDate: "2027-06-30",
  status: "ACTIVE",
  currentAmount: "",
  accountId: "",
};

beforeEach(() => {
  requireUserMock.mockReset().mockResolvedValue(OWNER);
  findAccountMock.mockReset().mockResolvedValue(ACCOUNT);
  createGoalMock.mockReset().mockResolvedValue({ id: "goal-1" });
  updateGoalMock.mockReset().mockResolvedValue(true);
  deleteGoalMock.mockReset().mockResolvedValue(true);
  revalidatePathMock.mockReset();
});

describe("createGoalAction", () => {
  it("records a manual-amount goal for the signed-in owner, without touching accounts", async () => {
    const result = await createGoalAction({ ...VALID_PAYLOAD, currentAmount: "300" });

    expect(result).toEqual({ status: "ok" });
    expect(findAccountMock).not.toHaveBeenCalled();

    expect(createGoalMock).toHaveBeenCalledTimes(1);
    const written = createGoalMock.mock.calls[0][0] as {
      userId: string;
      name: string;
      targetAmount: Decimal;
      currency: string;
      targetDate: Date;
      status: string;
      currentAmount: Decimal | null;
      accountId: string | null;
    };

    expect(written.userId).toBe(OWNER.id);
    expect(written.name).toBe("Apport immobilier");
    expect(written.targetAmount.toFixed(2)).toBe("1000.00");
    expect(written.currentAmount?.toFixed(2)).toBe("300.00");
    expect(written.currency).toBe("EUR");
    expect(written.targetDate.toISOString()).toBe("2027-06-30T00:00:00.000Z");
    expect(written.status).toBe("ACTIVE");
    expect(written.accountId).toBeNull();
    expect(revalidatePathMock).toHaveBeenCalledWith("/budget");
  });

  it("links one of the owner's accounts, looked up with the session", async () => {
    const result = await createGoalAction({ ...VALID_PAYLOAD, accountId: "account-1" });

    expect(result).toEqual({ status: "ok" });
    expect(findAccountMock).toHaveBeenCalledWith(OWNER.id, "account-1");

    const written = createGoalMock.mock.calls[0][0] as {
      currentAmount: Decimal | null;
      accountId: string | null;
    };
    expect(written.accountId).toBe("account-1");
    expect(written.currentAmount).toBeNull();
  });

  it("refuses an account the owner does not have, and writes nothing", async () => {
    findAccountMock.mockResolvedValue(null);

    const result = await createGoalAction({ ...VALID_PAYLOAD, accountId: "account-foreign" });

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.fieldErrors.accountId).toContain("Compte introuvable.");
    }
    expect(createGoalMock).not.toHaveBeenCalled();
  });

  it("refuses a currency mismatch instead of converting", async () => {
    findAccountMock.mockResolvedValue(ACCOUNT_USD);

    const result = await createGoalAction({ ...VALID_PAYLOAD, accountId: "account-2" });

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.message).toMatch(/USD/);
      expect(result.message).toMatch(/aucune conversion/);
    }
    expect(createGoalMock).not.toHaveBeenCalled();
  });

  it("refuses a manual amount and a linked account together", async () => {
    const result = await createGoalAction({
      ...VALID_PAYLOAD,
      currentAmount: "300",
      accountId: "account-1",
    });

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.fieldErrors.accountId?.[0]).toMatch(/pas les deux/);
    }
    expect(createGoalMock).not.toHaveBeenCalled();
  });

  it("refuses a target amount that is not strictly positive", async () => {
    const result = await createGoalAction({ ...VALID_PAYLOAD, targetAmount: "0" });

    expect(result.status).toBe("invalid");
    expect(createGoalMock).not.toHaveBeenCalled();
  });

  it("answers an unexpected failure without revealing anything", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    createGoalMock.mockRejectedValue(new Error("connection reset by peer"));

    const result = await createGoalAction({ ...VALID_PAYLOAD, currentAmount: "300" });

    expect(result).toEqual({
      status: "error",
      message: "Enregistrement impossible pour le moment. Réessayez dans un instant.",
    });
    consoleError.mockRestore();
  });
});

describe("updateGoalAction", () => {
  it("updates one goal of the owner", async () => {
    const result = await updateGoalAction({
      ...VALID_PAYLOAD,
      id: "goal-1",
      status: "ACHIEVED",
      currentAmount: "1000",
    });

    expect(result).toEqual({ status: "ok" });
    expect(updateGoalMock).toHaveBeenCalledTimes(1);
    expect(updateGoalMock.mock.calls[0][0]).toBe(OWNER.id);
    expect(updateGoalMock.mock.calls[0][1]).toBe("goal-1");

    const written = updateGoalMock.mock.calls[0][2] as { status: string; accountId: string | null };
    expect(written.status).toBe("ACHIEVED");
    expect(written.accountId).toBeNull();
  });

  it("answers not-found instead of pretending, and writes nothing", async () => {
    updateGoalMock.mockResolvedValue(false);

    const result = await updateGoalAction({ ...VALID_PAYLOAD, id: "goal-foreign" });

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.fieldErrors.id?.[0]).toMatch(/Objectif introuvable/);
    }
  });

  it("refuses an unidentified update", async () => {
    const result = await updateGoalAction({ ...VALID_PAYLOAD, id: "  " });

    expect(result.status).toBe("invalid");
    expect(updateGoalMock).not.toHaveBeenCalled();
  });
});

describe("deleteGoalAction", () => {
  it("deletes one goal of the owner", async () => {
    const result = await deleteGoalAction({ id: "goal-1" });

    expect(result).toEqual({ status: "ok" });
    expect(deleteGoalMock).toHaveBeenCalledWith(OWNER.id, "goal-1");
  });

  it("answers not-found for a goal that is already gone", async () => {
    deleteGoalMock.mockResolvedValue(false);

    const result = await deleteGoalAction({ id: "goal-1" });

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.fieldErrors.id?.[0]).toMatch(/Objectif introuvable/);
    }
  });
});
