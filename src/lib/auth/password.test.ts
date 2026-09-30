import { describe, expect, it } from "vitest";
import { burnPasswordComparison, hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("accepts the correct password", async () => {
    const hash = await hashPassword("Fictitious-Password-2026");

    expect(await verifyPassword("Fictitious-Password-2026", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("Fictitious-Password-2026");

    expect(await verifyPassword("fictitious-password-2026", hash)).toBe(false);
  });

  it("never stores the password in clear text", async () => {
    const hash = await hashPassword("Fictitious-Password-2026");

    expect(hash).not.toContain("Fictitious-Password-2026");
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("produces a different hash each time (salted)", async () => {
    const first = await hashPassword("Fictitious-Password-2026");
    const second = await hashPassword("Fictitious-Password-2026");

    expect(first).not.toBe(second);
  });

  it("always fails when burning a comparison, so an unknown address is indistinguishable", async () => {
    await expect(burnPasswordComparison("anything")).resolves.toBeUndefined();
  });
});
