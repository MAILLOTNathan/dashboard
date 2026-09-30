import type { IntegrationProvider, SyncOutcome } from "./domain";

/**
 * Provider adapter contract.
 *
 * Every provider is isolated behind this interface so that pagination, rate
 * limiting and error mapping are handled once per provider and the rest of the
 * application only sees normalised projects.
 *
 * The token is only ever used server-side. Tests inject a fake `fetchImpl`: no
 * test performs a real network call and no test needs a real token.
 */

export type ProviderErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "NETWORK"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly details: { status?: number; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = "ProviderError";
  }

  /** Message safe to persist and display: no token, no response body. */
  toSafeMessage(): string {
    const status = this.details.status ? ` (HTTP ${this.details.status})` : "";
    return `${this.code}${status}`;
  }
}

export type SyncRequest = {
  /** Provider token. Server-side only. */
  token: string;
  /** Empty string means the provider's public instance. */
  instanceUrl: string;
  /**
   * Scope to track: an organisation slug on GitHub, a group path on GitLab.
   * `null` means "everything the token can read".
   */
  owner: string | null;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Bounds a synchronisation so one run cannot loop forever. */
  maxPages?: number;
  pageSize?: number;
};

export interface IntegrationAdapter {
  readonly provider: IntegrationProvider;
  /** Read-only permissions: a display-only integration never asks for more. */
  readonly requiredScopes: readonly string[];
  listProjects(request: SyncRequest): Promise<SyncOutcome>;
}

export type JsonResponse<T> = {
  data: T;
  response: Response;
};

/**
 * Performs one request and maps transport and protocol failures to `ProviderError`.
 *
 * `classifyError` is provided by the adapter because rate-limit and scope
 * signals differ between providers.
 */
export async function requestJson<T>(options: {
  url: string;
  headers: Record<string, string>;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  classifyError: (response: Response) => ProviderError;
}): Promise<JsonResponse<T>> {
  let response: Response;

  try {
    response = await options.fetchImpl(options.url, {
      method: "GET",
      headers: options.headers,
      signal: options.signal,
      // Synchronisations must never be served from a cache.
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ProviderError("NETWORK", "Synchronisation annulée.");
    }
    throw new ProviderError(
      "NETWORK",
      `Le fournisseur est injoignable : ${error instanceof Error ? error.message : "erreur inconnue"}`,
    );
  }

  if (!response.ok) {
    throw options.classifyError(response);
  }

  try {
    return { data: (await response.json()) as T, response };
  } catch {
    throw new ProviderError(
      "INVALID_RESPONSE",
      "Réponse illisible du fournisseur.",
      { status: response.status },
    );
  }
}

export function parseRetryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) {
    return undefined;
  }

  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/** Validates one normalised project, so a malformed payload fails loudly. */
export function assertProjectShape(
  project: Partial<{ externalId: unknown; externalUrl: unknown; name: unknown }>,
  provider: IntegrationProvider,
): void {
  const isText = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0;

  if (
    !isText(project.externalId) ||
    !isText(project.externalUrl) ||
    !isText(project.name)
  ) {
    throw new ProviderError(
      "INVALID_RESPONSE",
      `Projet ${provider} incomplet : identifiant, nom ou URL manquant.`,
    );
  }
}
