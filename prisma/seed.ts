import "dotenv/config";
import { hashPassword } from "../src/lib/auth/password";
import { upsertOwner } from "../src/modules/identity/repository";

/**
 * Creates or updates the single owner account.
 *
 * There is no public sign-up: this script is the only way an account appears.
 * It is idempotent, so it can be run again to rotate the password.
 *
 * Never seed real personal data here. The name and address below are
 * placeholders, and the password comes from the environment.
 */
async function main(): Promise<void> {
  const email = process.env.SEED_OWNER_EMAIL;
  const password = process.env.SEED_OWNER_PASSWORD;
  const name = process.env.SEED_OWNER_NAME ?? "Proprietaire";

  if (!email || !password) {
    throw new Error(
      "SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD are required. Copy .env.example to .env and set them locally.",
    );
  }

  if (password.length < 12) {
    throw new Error(
      "SEED_OWNER_PASSWORD must be at least 12 characters long: it protects the whole dashboard.",
    );
  }

  const passwordHash = await hashPassword(password);
  const owner = await upsertOwner({ email, name, passwordHash });

  // Only the identifier is printed: never the password, never the hash.
  console.log(`Owner account ready: ${owner.email} (${owner.id})`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    // Nothing to close explicitly: the Prisma client is released with the process.
  });
