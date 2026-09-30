import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** Owner identifier, taken from the session token. */
      id: string;
    } & DefaultSession["user"];
  }
}
