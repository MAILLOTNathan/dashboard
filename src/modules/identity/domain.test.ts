import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  passwordChangeSchema,
} from "./domain";

/** Fictitious values only: no test ever carries a real password. */
const VALID = {
  currentPassword: "Fictitious-Current-2026",
  newPassword: "Fictitious-Replacement-2026",
  confirmPassword: "Fictitious-Replacement-2026",
};

/** Messages reported on one field, so a rule is asserted where the user sees it. */
function messagesForField(payload: unknown, field: string): string[] {
  const parsed = passwordChangeSchema.safeParse(payload);

  if (parsed.success) {
    return [];
  }

  return parsed.error.issues
    .filter((issue) => issue.path.join(".") === field)
    .map((issue) => issue.message);
}

describe("passwordChangeSchema", () => {
  it("accepts a change that confirms itself", () => {
    const parsed = passwordChangeSchema.safeParse(VALID);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.newPassword).toBe(VALID.newPassword);
  });

  it("keeps the typed values untouched, spaces included", () => {
    const parsed = passwordChangeSchema.safeParse({
      ...VALID,
      currentPassword: " spaced current ",
      newPassword: " spaced replacement ",
      confirmPassword: " spaced replacement ",
    });

    // Trimming here would store something other than what was typed, and the
    // sign-in form does not trim either.
    expect(parsed.success && parsed.data.newPassword).toBe(" spaced replacement ");
    expect(parsed.success && parsed.data.currentPassword).toBe(" spaced current ");
  });

  it("requires a new password of at least the minimum length", () => {
    const shorter = "a".repeat(PASSWORD_MIN_LENGTH - 1);

    const messages = messagesForField(
      { ...VALID, newPassword: shorter, confirmPassword: shorter },
      "newPassword",
    );

    expect(messages.some((message) => message.includes(String(PASSWORD_MIN_LENGTH)))).toBe(
      true,
    );
  });

  it("accepts a new password of exactly the minimum length", () => {
    const exact = "a".repeat(PASSWORD_MIN_LENGTH);

    const parsed = passwordChangeSchema.safeParse({
      ...VALID,
      newPassword: exact,
      confirmPassword: exact,
    });

    expect(parsed.success).toBe(true);
  });

  it("refuses a password longer than bcrypt reads, counting accents as two bytes", () => {
    // 40 characters, but 80 bytes: bcrypt would silently ignore everything past
    // byte 72, which would let a second password open the same account.
    const accented = "é".repeat(PASSWORD_MAX_BYTES / 2 + 8);

    expect(accented.length).toBeLessThan(PASSWORD_MAX_BYTES);
    expect(
      messagesForField({ ...VALID, newPassword: accented, confirmPassword: accented }, "newPassword"),
    ).not.toHaveLength(0);
  });

  it("accepts a password of exactly the byte limit", () => {
    const exact = "a".repeat(PASSWORD_MAX_BYTES);

    const parsed = passwordChangeSchema.safeParse({
      ...VALID,
      newPassword: exact,
      confirmPassword: exact,
    });

    expect(parsed.success).toBe(true);
  });

  it("refuses a password made only of spaces", () => {
    const blank = " ".repeat(PASSWORD_MIN_LENGTH + 4);

    expect(
      messagesForField({ ...VALID, newPassword: blank, confirmPassword: blank }, "newPassword"),
    ).not.toHaveLength(0);
  });

  it("reports a confirmation that does not match, on the confirmation field", () => {
    const payload = { ...VALID, confirmPassword: "Fictitious-Replacement-2027" };

    expect(messagesForField(payload, "confirmPassword")).not.toHaveLength(0);
    expect(messagesForField(payload, "newPassword")).toHaveLength(0);
  });

  it("refuses a new password identical to the current one", () => {
    // Otherwise the change would look successful while nothing changed.
    const messages = messagesForField(
      {
        currentPassword: VALID.newPassword,
        newPassword: VALID.newPassword,
        confirmPassword: VALID.newPassword,
      },
      "newPassword",
    );

    expect(messages).not.toHaveLength(0);
  });

  it("requires the current password", () => {
    expect(messagesForField({ ...VALID, currentPassword: "" }, "currentPassword")).not.toHaveLength(
      0,
    );
  });
});
