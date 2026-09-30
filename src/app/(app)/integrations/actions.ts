"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guard";
import { connectionInputSchema } from "@/modules/integrations/domain";
import { upsertConnection } from "@/modules/integrations/repository";
import { synchroniseConnection } from "@/jobs/sync";

/**
 * Server Actions for the integrations module.
 *
 * Authorisation is checked here, on the server, and the connection is always
 * looked up for the signed-in owner: a request body can never name another
 * user's connection.
 */

export async function connectProviderAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const parsed = connectionInputSchema.safeParse({
    provider: formData.get("provider"),
    instanceUrl: formData.get("instanceUrl") ?? "",
    externalOwner: formData.get("externalOwner") || null,
    token: formData.get("token"),
  });

  if (!parsed.success) {
    redirect("/integrations?status=invalid");
  }

  await upsertConnection({
    userId: user.id,
    provider: parsed.data.provider,
    instanceUrl: parsed.data.instanceUrl,
    externalOwner: parsed.data.externalOwner,
    // Read-only permissions are declared by the adapters, never granted here.
    permissions: [],
    token: parsed.data.token,
  });

  revalidatePath("/integrations");
  redirect("/integrations?status=connected");
}

export async function syncConnectionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const connectionId = formData.get("connectionId");

  if (typeof connectionId !== "string" || connectionId === "") {
    redirect("/integrations?sync=invalid");
  }

  // A manual one-shot run. Scheduled synchronisations use the same function from
  // a scheduler outside the web process.
  const result = await synchroniseConnection(user.id, connectionId);

  revalidatePath("/integrations");

  const repository = formData.get("repository");
  const focus = typeof repository === "string" && repository !== "" ? repository : null;

  if (result.status === "SYNCHRONISED") {
    const params = new URLSearchParams({
      sync: "ok",
      projects: String(result.projectCount),
      issues: String(result.issueCount),
      tracking: result.issueTracking ? "on" : "off",
    });

    if (focus) {
      params.set("repo", focus);
    }

    redirect(`/integrations?${params.toString()}`);
  }
  if (result.status === "FAILED") {
    redirect(`/integrations?sync=error&code=${encodeURIComponent(result.code)}`);
  }
  redirect(`/integrations?sync=skipped&reason=${encodeURIComponent(result.reason)}`);
}
