import {
  assertProjectShape,
  parseRetryAfterSeconds,
  ProviderError,
  requestJson,
  type IntegrationAdapter,
  type SyncRequest,
} from "./adapter";
import type { ProviderProject, SyncOutcome } from "./domain";

/**
 * GitHub adapter (read-only).
 *
 * The token needs `repo` (or a fine-grained read-only equivalent) to see private
 * repositories the owner is allowed to read. Only normalised metadata is kept:
 * no file content, no commit content.
 */
const API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 5;

type GitHubRepository = {
  id?: unknown;
  full_name?: unknown;
  html_url?: unknown;
  private?: unknown;
  default_branch?: unknown;
  language?: unknown;
  stargazers_count?: unknown;
  open_issues_count?: unknown;
  pushed_at?: unknown;
};

/** Reads the `rel="next"` link returned by GitHub; `null` means the last page. */
export function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }

  for (const part of linkHeader.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="([^"]+)"/.exec(part.trim());
    if (match && match[2] === "next") {
      return match[1];
    }
  }

  return null;
}

export function classifyGitHubError(response: Response): ProviderError {
  const status = response.status;

  if (status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const retryAfterSeconds = Number.isFinite(reset)
      ? Math.max(0, reset - Math.floor(Date.now() / 1000))
      : undefined;

    return new ProviderError("RATE_LIMITED", "Quota GitHub atteint.", {
      status,
      retryAfterSeconds,
    });
  }

  if (status === 401 || status === 403) {
    return new ProviderError(
      "UNAUTHORIZED",
      "Jeton GitHub refusé ou permissions insuffisantes.",
      { status },
    );
  }

  if (status === 404) {
    return new ProviderError("NOT_FOUND", "Organisation GitHub introuvable.", {
      status,
    });
  }

  if (status === 429) {
    return new ProviderError("RATE_LIMITED", "Quota GitHub atteint.", {
      status,
      retryAfterSeconds: parseRetryAfterSeconds(response),
    });
  }

  return new ProviderError("HTTP_ERROR", "Erreur GitHub.", { status });
}

export function normaliseGitHubRepository(
  repository: GitHubRepository,
): ProviderProject {
  const project: ProviderProject = {
    externalId: String(repository.id ?? ""),
    externalUrl: typeof repository.html_url === "string" ? repository.html_url : "",
    name: typeof repository.full_name === "string" ? repository.full_name : "",
    visibility: repository.private === true ? "private" : "public",
    metrics: {
      defaultBranch: repository.default_branch ?? null,
      language: repository.language ?? null,
      stars: typeof repository.stargazers_count === "number" ? repository.stargazers_count : null,
      openIssues:
        typeof repository.open_issues_count === "number" ? repository.open_issues_count : null,
      lastPushAt: repository.pushed_at ?? null,
    },
  };

  assertProjectShape(project, "GITHUB");
  return project;
}

export function createGitHubAdapter(): IntegrationAdapter {
  return {
    provider: "GITHUB",
    requiredScopes: ["repo:read"],

    async listProjects(request: SyncRequest): Promise<SyncOutcome> {
      const fetchImpl = request.fetchImpl ?? fetch;
      const pageSize = request.pageSize ?? DEFAULT_PAGE_SIZE;
      const maxPages = request.maxPages ?? DEFAULT_MAX_PAGES;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${request.token}`,
        "X-GitHub-Api-Version": API_VERSION,
      };

      // GitHub has no "all repositories" endpoint: an organisation is listed
      // through /orgs, the owner's own access through /user/repos.
      const firstPage = request.owner
        ? `${API_BASE}/orgs/${encodeURIComponent(request.owner)}/repos?per_page=${pageSize}&type=all&sort=updated`
        : `${API_BASE}/user/repos?per_page=${pageSize}&affiliation=owner,collaborator,organization_member&sort=updated`;

      const projects: ProviderProject[] = [];
      let url: string | null = firstPage;
      let pages = 0;

      while (url && pages < maxPages) {
        const { data, response }: { data: unknown; response: Response } =
          await requestJson<unknown>({
            url,
            headers,
            fetchImpl,
            signal: request.signal,
            classifyError: classifyGitHubError,
          });

        if (!Array.isArray(data)) {
          throw new ProviderError(
            "INVALID_RESPONSE",
            "GitHub n'a pas renvoyé une liste de dépôts.",
            { status: response.status },
          );
        }

        for (const repository of data as GitHubRepository[]) {
          projects.push(normaliseGitHubRepository(repository));
        }

        pages += 1;
        // Pagination continues only while the provider announces another page:
        // partial synchronisation is preferable to a truncated silent one.
        url = pages < maxPages ? nextPageUrl(response.headers.get("link")) : null;
      }

      return { projects, fetchedAt: new Date() };
    },
  };
}
