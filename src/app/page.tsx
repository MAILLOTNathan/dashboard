import { redirect } from "next/navigation";

/**
 * Entry point.
 *
 * The dashboard is the only home page; the (app) layout sends an anonymous
 * visitor to /login.
 */
export default function Home() {
  redirect("/dashboard");
}
