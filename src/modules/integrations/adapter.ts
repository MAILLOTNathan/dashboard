import type {
  IntegrationProvider,
  ProviderIssue,
  ProviderMilestone,
  ProviderProject,
  SyncOutcome,
} from "./domain";

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
  /**
   * False when open issues are deliberately not fetched for this provider. The
   * interface then says so instead of showing an empty list, which would read as
   * "nothing is open".
   */
  readonly tracksIssues: boolean;
  /** Same idea for milestones: false means the interface must say "not tracked". */
  readonly tracksMilestones: boolean;
  listProjects(request: SyncRequest): Promise<SyncOutcome>;
  listIssues(request: IssueSyncRequest): Promise<IssueSyncOutcome>;
  listMilestones(request: IssueSyncRequest): Promise<MilestoneSyncOutcome>;
}

/**
 * Issues are fetched per repository, which is more requests than listing projects,
 * so the run is bounded on purpose: a synchronisation must stay short and must not
 * burn a whole rate-limit window on repositories nobody touched for a year.
 */
export type IssueSyncRequest = SyncRequest & {
  /** Projects returned by `listProjects` in the same run. */
  projects: readonly ProviderProject[];
  /** Upper bound on the repositories queried. The most recently active come first. */
  maxRepositories?: number;
  /** Upper bound on the issues kept per repository. */
  pageSize?: number;
};

/** How much of the repository list a bounded scan actually covered. */
export type RepositoryScanSummary = {
  /** Repositories actually read during this run. */
  repositoriesScanned: number;
  /** Repositories left out because of the bound: their data is unknown, not zero. */
  repositoriesSkipped: number;
  /** Repositories the provider refused to answer for (renamed, moved, deleted). */
  repositoriesFailed: number;
};

export type IssueSyncOutcome = RepositoryScanSummary & {
  /** False for a provider whose issues are not tracked; the list is then empty. */
  supported: boolean;
  issues: ProviderIssue[];
  fetchedAt: Date;
};

export type MilestoneSyncOutcome = RepositoryScanSummary & {
  supported: boolean;
  milestones: ProviderMilestone[];
  fetchedAt: Date;
};

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

/**
 * Validates one normalised issue.
 *
 * An issue without an identifier, a title or a link cannot be displayed and would
 * silently pollute the table, so the run fails instead of storing a half-row.
 */
export function assertIssueShape(
  issue: Partial<{
    externalId: unknown;
    title: unknown;
    url: unknown;
    number: unknown;
    openedAt: unknown;
  }>,
  provider: IntegrationProvider,
): void {
  const isText = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0;

  if (
    !isText(issue.externalId) ||
    !isText(issue.title) ||
    !isText(issue.url) ||
    typeof issue.number !== "number" ||
    issue.number <= 0 ||
    !(issue.openedAt instanceof Date) ||
    Number.isNaN(issue.openedAt.getTime())
  ) {
    throw new ProviderError(
      "INVALID_RESPONSE",
      `Issue ${provider} incomplète : identifiant, numéro, titre, URL ou date manquant.`,
    );
  }
}

/**
 * Validates one normalised milestone. A milestone without an identifier or a title
 * could not be displayed nor filtered, so it fails the run instead of being stored.
 */
export function assertMilestoneShape(
  milestone: Partial<{ externalId: unknown; title: unknown; number: unknown }>,
  provider: IntegrationProvider,
): void {
  const isText = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0;

  if (
    !isText(milestone.externalId) ||
    !isText(milestone.title) ||
    typeof milestone.number !== "number"
  ) {
    throw new ProviderError(
      "INVALID_RESPONSE",
      `Jalon ${provider} incomplet : identifiant, numéro ou titre manquant.`,
    );
  }
}

/**
 * Reads an ISO instant returned by a provider.
 *
 * A missing or unreadable date is a malformed response: defaulting it to now would
 * make an ancient issue look new, which is exactly the mistake this feature exists
 * to prevent.
 */
export function parseProviderInstant(
  value: unknown,
  provider: IntegrationProvider,
): Date {
  const parsed = typeof value === "string" ? new Date(value) : new Date(Number.NaN);

  if (Number.isNaN(parsed.getTime())) {
    throw new ProviderError(
      "INVALID_RESPONSE",
      `Date illisible renvoyée par ${provider}.`,
    );
  }

  return parsed;
}
