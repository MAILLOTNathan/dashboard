import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption of provider tokens at rest (AES-256-GCM).
 *
 * Tokens are never stored in clear text, never logged, and never sent to the
 * browser. The key comes from `INTEGRATION_ENCRYPTION_KEY` and lives outside Git.
 */
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const FORMAT_VERSION = "v1";

export class InvalidEncryptionKeyError extends Error {
  constructor(reason: string) {
    super(`INTEGRATION_ENCRYPTION_KEY is invalid: ${reason}`);
    this.name = "InvalidEncryptionKeyError";
  }
}

export class InvalidCiphertextError extends Error {
  constructor(reason: string) {
    super(`Stored secret cannot be read: ${reason}`);
    this.name = "InvalidCiphertextError";
  }
}

/** Decodes the base64 key and checks its length, so a typo cannot weaken the encryption. */
export function decodeEncryptionKey(base64Key: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(base64Key, "base64");
  } catch {
    throw new InvalidEncryptionKeyError("not valid base64");
  }

  if (key.length !== KEY_BYTES) {
    throw new InvalidEncryptionKeyError(
      `expected ${KEY_BYTES} bytes after base64 decoding, got ${key.length}`,
    );
  }

  return key;
}

/** Returns `v1.<iv>.<authTag>.<ciphertext>`, all base64 encoded. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new InvalidEncryptionKeyError(`expected ${KEY_BYTES} bytes, got ${key.length}`);
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    FORMAT_VERSION,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/** Fails loudly (rather than returning garbage) on a wrong key or a tampered payload. */
export function decryptSecret(payload: string, key: Buffer): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new InvalidCiphertextError("unrecognised format");
  }

  const [, ivPart, tagPart, ciphertextPart] = parts;
  const iv = Buffer.from(ivPart, "base64");
  const authTag = Buffer.from(tagPart, "base64");
  const ciphertext = Buffer.from(ciphertextPart, "base64");

  if (iv.length !== IV_BYTES || authTag.length !== 16) {
    throw new InvalidCiphertextError("truncated initialisation vector or authentication tag");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new InvalidCiphertextError(
      "decryption failed: wrong key or modified payload",
    );
  }
}
