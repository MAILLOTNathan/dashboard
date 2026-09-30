import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const findOwnerByIdMock = vi.fn();

vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("@/modules/identity/repository", () => ({
  findOwnerById: (id: string) => findOwnerByIdMock(id),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const { getSessionUser, requireUser } = await import("./guard");

/** Fictitious owner only. */
const owner = {
  id: "user-1",
  email: "owner@example.test",
  name: "Proprietaire",
  passwordHash: "$2b$12$not-a-real-hash",
};

describe("getSessionUser", () => {
  beforeEach(() => {
    authMock.mockReset();
    findOwnerByIdMock.mockReset();
  });

  it("returns null without a session, without touching the database", async () => {
    authMock.mockResolvedValue(null);

    expect(await getSessionUser()).toBeNull();
    expect(findOwnerByIdMock).not.toHaveBeenCalled();
  });

  it("returns null when the token carries no user id", async () => {
    authMock.mockResolvedValue({ user: { email: owner.email } });

    expect(await getSessionUser()).toBeNull();
    expect(findOwnerByIdMock).not.toHaveBeenCalled();
  });

  it("returns the owner when the row still exists", async () => {
    authMock.mockResolvedValue({ user: { id: owner.id, email: owner.email, name: owner.name } });
    findOwnerByIdMock.mockResolvedValue(owner);

    expect(await getSessionUser()).toEqual({
      id: owner.id,
      email: owner.email,
      name: owner.name,
    });
    expect(findOwnerByIdMock).toHaveBeenCalledWith(owner.id);
  });

  it("treats a session whose owner row disappeared as signed out", async () => {
    // A recreated database issues new identifiers while the browser keeps the
    // previous cookie: without this check the pages read nothing and every write
    // fails on a foreign key, which is unreadable for the owner.
    authMock.mockResolvedValue({ user: { id: "recreated-away", email: owner.email } });
    findOwnerByIdMock.mockResolvedValue(null);

    expect(await getSessionUser()).toBeNull();
  });
});

describe("requireUser", () => {
  beforeEach(() => {
    authMock.mockReset();
    findOwnerByIdMock.mockReset();
  });

  it("redirects an anonymous visitor to the sign-in page", async () => {
    authMock.mockResolvedValue(null);

    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });

  it("redirects instead of letting a stale session reach a page", async () => {
    authMock.mockResolvedValue({ user: { id: "recreated-away", email: owner.email } });
    findOwnerByIdMock.mockResolvedValue(null);

    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });

  it("lets the owner through", async () => {
    authMock.mockResolvedValue({ user: { id: owner.id, email: owner.email } });
    findOwnerByIdMock.mockResolvedValue(owner);

    await expect(requireUser()).resolves.toMatchObject({ id: owner.id });
  });
});
