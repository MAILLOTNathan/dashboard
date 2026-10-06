import "dotenv/config";
import { hashPassword } from "../src/lib/auth/password";
import { ensureCategory } from "../src/modules/budget/repository";
import { SALARY_CATEGORY_NAME } from "../src/modules/budget/salary";
import { PASSWORD_MIN_LENGTH } from "../src/modules/identity/domain";
import { findOwnerByEmail, upsertOwner } from "../src/modules/identity/repository";

/**
 * Creates the single owner account, or refreshes the name of the one that exists.
 *
 * There is no public sign-up: this script is the only way an account appears.
 *
 * The environment password is written when the account is created. Once it has been
 * changed from the Compte page, this script keeps the stored hash instead of
 * overwriting it: the stack runs it on every `up`, and silently reverting a password
 * the owner has just chosen is a strange way to lose a credential.
 * `SEED_OWNER_FORCE_PASSWORD=true` puts the environment value back in force, which is
 * also the way out of a forgotten password.
 *
 * Never seed real personal data here. The name and address below are
 * placeholders, and the password comes from the environment.
 */
async function main(): Promise<void> {
  const email = process.env.SEED_OWNER_EMAIL;
  const password = process.env.SEED_OWNER_PASSWORD;
  const name = process.env.SEED_OWNER_NAME ?? "Proprietaire";
  const forcePassword = process.env.SEED_OWNER_FORCE_PASSWORD === "true";

  if (!email || !password) {
    throw new Error(
      "SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD are required. Copy .env.example to .env and set them locally.",
    );
  }

  const existing = await findOwnerByEmail(email);
  const keepsStoredPassword = existing !== null && !forcePassword;

  // Only checked when the value is actually about to be written: a short placeholder
  // must not fail a run that changes nothing.
  if (!keepsStoredPassword && password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(
      `SEED_OWNER_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters long: it protects the whole dashboard.`,
    );
  }

  const passwordHash = keepsStoredPassword
    ? existing.passwordHash
    : await hashPassword(password);
  const owner = await upsertOwner({ email, name, passwordHash });

  // The salary simulator books its income into a « Salaire » category: it is created here
  // so every owner has it from the start. The booking action also creates it on demand,
  // which covers owners seeded before this default existed. Never personal data: the
  // category is empty until the owner records something in it.
  await ensureCategory({ userId: owner.id, name: SALARY_CATEGORY_NAME, kind: "INCOME" });

  // Only the identifier is printed: never the password, never the hash.
  console.log(
    keepsStoredPassword
      ? `Owner account ready: ${owner.email} (${owner.id}); stored password kept (set SEED_OWNER_FORCE_PASSWORD=true to overwrite it)`
      : `Owner account ready: ${owner.email} (${owner.id})`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    // Nothing to close explicitly: the Prisma client is released with the process.
  });
