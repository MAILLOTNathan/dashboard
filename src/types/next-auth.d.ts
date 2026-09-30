import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** Owner identifier, taken from the session token. */
      id: string;
    } & DefaultSession["user"];
    /**
     * Fingerprint of the password hash this session was issued for.
     *
     * A non-reversible digest, never the hash itself. `getSessionUser()` compares
     * it with the stored row so that a password change signs out the sessions
     * opened before it.
     */
    passwordTag?: string;
  }

  interface User {
    /** Set by the credentials provider, carried into the token, never displayed. */
    passwordTag?: string;
  }
}

/**
 * The token interface belongs to `@auth/core/jwt`, which `next-auth/jwt` merely
 * re-exports: augmenting the re-export would declare the field on a module nothing
 * reads, leaving `token.passwordTag` typed as the `unknown` of its index signature.
 */
declare module "@auth/core/jwt" {
  interface JWT {
    /** See `Session.passwordTag`. */
    passwordTag?: string;
  }
}
