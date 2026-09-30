import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decodeEncryptionKey,
  decryptSecret,
  encryptSecret,
  InvalidCiphertextError,
  InvalidEncryptionKeyError,
} from "./crypto";

const KEY = randomBytes(32);

describe("provider token encryption", () => {
  it("round-trips a token", () => {
    const ciphertext = encryptSecret("glpat-fictitious-token", KEY);

    expect(ciphertext).not.toContain("glpat-fictitious-token");
    expect(decryptSecret(ciphertext, KEY)).toBe("glpat-fictitious-token");
  });

  it("produces a different ciphertext every time (unique initialisation vector)", () => {
    const first = encryptSecret("same-token", KEY);
    const second = encryptSecret("same-token", KEY);

    expect(first).not.toBe(second);
    expect(decryptSecret(second, KEY)).toBe("same-token");
  });

  it("refuses to decrypt with another key instead of returning garbage", () => {
    const ciphertext = encryptSecret("glpat-fictitious-token", KEY);

    expect(() => decryptSecret(ciphertext, randomBytes(32))).toThrow(
      InvalidCiphertextError,
    );
  });

  it("detects a modified payload", () => {
    const ciphertext = encryptSecret("glpat-fictitious-token", KEY);
    const parts = ciphertext.split(".");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("tampered").toString("base64")].join(".");

    expect(() => decryptSecret(tampered, KEY)).toThrow(InvalidCiphertextError);
  });

  it("rejects an unrecognised format", () => {
    expect(() => decryptSecret("plain-token", KEY)).toThrow(InvalidCiphertextError);
  });
});

describe("decodeEncryptionKey", () => {
  it("decodes a valid 32-byte key", () => {
    const key = decodeEncryptionKey(KEY.toString("base64"));

    expect(key).toHaveLength(32);
  });

  it("rejects a key that is too short, instead of silently weakening the cipher", () => {
    expect(() => decodeEncryptionKey(Buffer.from("too-short").toString("base64"))).toThrow(
      InvalidEncryptionKeyError,
    );
  });
});
