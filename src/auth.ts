import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "@/auth.config";
import { burnPasswordComparison, verifyPassword } from "@/lib/auth/password";
import { findOwnerByEmail, normaliseEmail } from "@/modules/identity/repository";

/**
 * Server-side Auth.js instance.
 *
 * A single owner signs in with an email and a password. There is no public
 * sign-up: accounts are created by `npm run db:seed`.
 */
const credentialsSchema = z.object({
  email: z.string().min(3),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Adresse e-mail", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      /**
       * Returns `null` for every failure: the caller must not learn whether the
       * address exists, only that the pair is wrong.
       */
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) {
          return null;
        }

        const owner = await findOwnerByEmail(normaliseEmail(parsed.data.email));

        if (!owner) {
          await burnPasswordComparison(parsed.data.password);
          return null;
        }

        const isPasswordValid = await verifyPassword(
          parsed.data.password,
          owner.passwordHash,
        );
        if (!isPasswordValid) {
          return null;
        }

        return {
          id: owner.id,
          email: owner.email,
          name: owner.name ?? undefined,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Only the identifier travels in the token; no password hash, no token, no budget data.
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
