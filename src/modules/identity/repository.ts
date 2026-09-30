import { getPrisma } from "@/lib/db";

/**
 * Identity module.
 *
 * The dashboard has a single owner and no public sign-up: accounts are created
 * by the seed script, never by a web form.
 */

export type OwnerAccount = {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string;
};

/** Addresses are stored and compared in lower case so `Owner@` and `owner@` match. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findOwnerByEmail(email: string): Promise<OwnerAccount | null> {
  const user = await getPrisma().user.findUnique({
    where: { email: normaliseEmail(email) },
    select: { id: true, email: true, name: true, passwordHash: true },
  });

  return user;
}

export async function findOwnerById(id: string): Promise<OwnerAccount | null> {
  return getPrisma().user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, passwordHash: true },
  });
}

export async function countOwners(): Promise<number> {
  return getPrisma().user.count();
}

/**
 * Creates or updates the owner account. Used by the seed script only, so it is
 * idempotent: running it twice does not create a second account.
 */
export async function upsertOwner(input: {
  email: string;
  name: string;
  passwordHash: string;
}): Promise<{ id: string; email: string }> {
  const email = normaliseEmail(input.email);

  return getPrisma().user.upsert({
    where: { email },
    create: { email, name: input.name, passwordHash: input.passwordHash },
    update: { name: input.name, passwordHash: input.passwordHash },
    select: { id: true, email: true },
  });
}
