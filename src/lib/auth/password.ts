import { compare, hash } from "bcryptjs";

/**
 * Password hashing for the sole owner account.
 *
 * bcrypt is deliberately slow: the cost factor is a trade-off between resistance
 * to offline guessing and login latency. 12 is a reasonable default for a
 * single-user application.
 */
const BCRYPT_COST = 12;

/**
 * Hash of a random throwaway value, compared when no account matches so that a
 * failed login costs the same time whether or not the address exists. Without
 * it, response times reveal which address is registered.
 */
const ABSENT_USER_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.gyqWe4RSHMhhAeYYeDUsy0sHd4b0bLu";

export async function hashPassword(plainPassword: string): Promise<string> {
  return hash(plainPassword, BCRYPT_COST);
}

export async function verifyPassword(
  plainPassword: string,
  passwordHash: string,
): Promise<boolean> {
  return compare(plainPassword, passwordHash);
}

/** Performs a comparison that always fails, purely to keep the timing constant. */
export async function burnPasswordComparison(plainPassword: string): Promise<void> {
  await compare(plainPassword, ABSENT_USER_HASH);
}
