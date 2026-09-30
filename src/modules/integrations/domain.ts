import { z } from "zod";

/**
 * Integrations module (GitHub, GitLab).
 *
 * Read-only by construction: only read scopes are requested, no adapter offers a
 * write operation, and nothing from a provider is stored except the normalised
 * fields the dashboard displays. GitLab may be self-hosted, so the instance URL
 * is part of the connection identity.
 */

export const INTEGRATION_PROVIDERS = ["GITHUB", "GITLAB"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_STATUSES = ["NOT_CONNECTED", "CONNECTED", "ERROR"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/**
 * "No data" is not "not connected" and not "synchronisation failed": the three
 * states stay distinct, and a synchronisation error is never rendered as a zero.
 */
export type ConnectionState =
  | { kind: "NOT_CONNECTED" }
  | { kind: "CONNECTED"; lastSyncedAt: Date; projectCount: number }
  | { kind: "NEVER_SYNCED" }
  | { kind: "ERROR"; lastSyncError: string | null; lastSyncedAt: Date | null };

export type ProviderProject = {
  /** Identifier at the provider, kept to make re-synchronisations idempotent. */
  externalId: string;
  externalUrl: string;
  name: string;
  visibility: string | null;
  /** Only the fields the interface displays; never private source code. */
  metrics: Record<string, unknown>;
};

export type SyncOutcome = {
  projects: ProviderProject[];
  fetchedAt: Date;
};

export type ConnectionSummary = {
  id: string;
  provider: IntegrationProvider;
  instanceUrl: string;
  externalOwner: string | null;
  permissions: string[];
  status: IntegrationStatus;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  /** A token is stored, but its value never leaves the server. */
  hasStoredToken: boolean;
  projectCount: number;
};

/** Public host used when the connection targets the provider's own instance. */
export function publicInstanceLabel(provider: IntegrationProvider): string {
  return provider === "GITHUB" ? "github.com" : "gitlab.com";
}

export function describeInstance(
  provider: IntegrationProvider,
  instanceUrl: string,
): string {
  return instanceUrl.trim() === "" ? publicInstanceLabel(provider) : instanceUrl.trim();
}

export const connectionInputSchema = z.object({
  provider: z.enum(INTEGRATION_PROVIDERS),
  /** Empty string means the provider's public instance, never NULL. */
  instanceUrl: z
    .string()
    .trim()
    .transform((value) => value.replace(/\/+$/, ""))
    .refine(
      (value) => value === "" || /^https?:\/\/[^\s/]+/.test(value),
      "L'URL d'instance doit commencer par http:// ou https://",
    ),
  externalOwner: z.string().trim().max(200).nullable().default(null),
  /** Sent to the provider and stored encrypted. Never rendered back to the browser. */
  token: z.string().min(1, "Un jeton est requis pour se connecter."),
});

export type ConnectionInput = z.input<typeof connectionInputSchema>;

/** Derives the state a page must display, without inventing a value for missing data. */
export function describeConnectionState(connection: {
  status: IntegrationStatus;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  projectCount: number;
}): ConnectionState {
  if (connection.status === "NOT_CONNECTED") {
    return { kind: "NOT_CONNECTED" };
  }

  if (connection.status === "ERROR") {
    return {
      kind: "ERROR",
      lastSyncError: connection.lastSyncError,
      lastSyncedAt: connection.lastSyncedAt,
    };
  }

  if (!connection.lastSyncedAt) {
    return { kind: "NEVER_SYNCED" };
  }

  return {
    kind: "CONNECTED",
    lastSyncedAt: connection.lastSyncedAt,
    projectCount: connection.projectCount,
  };
}
