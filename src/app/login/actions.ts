"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn } from "@/auth";

/** Sign-in and sign-out actions. Both run on the server only. */

const loginSchema = z.object({
  email: z.string().min(3),
  password: z.string().min(1),
});

export async function loginAction(formData: FormData): Promise<void> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect("/login?error=invalid");
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    // `signIn` signals a successful sign-in by throwing a redirect: it must be
    // rethrown, otherwise the user stays on the form with no session.
    if (error instanceof AuthError) {
      redirect("/login?error=credentials");
    }
    throw error;
  }
}

export async function signOutAction(): Promise<void> {
  const { signOut } = await import("@/auth");
  await signOut({ redirectTo: "/login" });
}
