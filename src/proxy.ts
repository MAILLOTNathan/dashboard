import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

/**
 * Proxy (formerly `middleware`), invoked before a request is rendered.
 *
 * It redirects an anonymous visitor to the sign-in page as a convenience, using
 * the edge-safe configuration only: no database access happens here.
 *
 * This is **not** a security boundary. Every page, Route Handler and Server
 * Action checks the session again on the server through `requireUser()`, because
 * a proxy matcher that misses a path would otherwise expose the data behind it.
 */
export default NextAuth(authConfig).auth;

export const config = {
  // Next.js assets are skipped, and so is every API route: a Route Handler must
  // answer 401 with a JSON body, not redirect a client to an HTML login page.
  // The session is checked again inside each handler.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
