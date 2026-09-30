import {
  assertIssueShape,
  assertProjectShape,
  parseProviderInstant,
  parseRetryAfterSeconds,
  ProviderError,
  requestJson,
  type IntegrationAdapter,
  type IssueSyncOutcome,
  type IssueSyncRequest,
  type SyncRequest,
} from "./adapter";
import type { ProviderIssue, ProviderProject, SyncOutcome } from "./domain";

/**
 * GitHub adapter (read-only).
 *
 * The token needs `repo` (or a fine-grained read-only equivalent) to see private
 * repositories the owner is allowed to read. Only normalised metadata is kept:
 * no file content, no commit content, no issue description, no comment body.
 */
const API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 5;
/** Issues are queried per repository, so the run is bounded. */
const DEFAULT_MAX_REPOSITORIES = 20;
const DEFAULT_ISSUE_PAGE_SIZE = 30;
const MAX_LABELS = 5;

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

/**
 * Shape of the issues endpoint, which returns **issues and pull requests together**.
 * The `pull_request` key is what separates them, and it is why this adapter never
 * trusts a repository's `open_issues_count` for a count of issues: that number
 * includes pull requests on GitHub.
 */
type GitHubIssue = {
  id?: unknown;
  number?: unknown;
  title?: unknown;
  html_url?: unknown;
  comments?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  labels?: unknown;
  user?: unknown;
  pull_request?: unknown;
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
    tracksIssues: true,

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

    /**
     * Open issues and pull requests, one request per repository.
     *
     * Only the repositories that moved most recently are queried, so a run stays
     * short and a large organisation does not consume a whole rate-limit window on
     * repositories nobody touched for a year. What was left out is reported in
     * `repositoriesSkipped`: the interface says "not read", never "nothing open".
     */
    async listIssues(request: IssueSyncRequest): Promise<IssueSyncOutcome> {
      const fetchImpl = request.fetchImpl ?? fetch;
      const pageSize = request.pageSize ?? DEFAULT_ISSUE_PAGE_SIZE;
      const maxRepositories = request.maxRepositories ?? DEFAULT_MAX_REPOSITORIES;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${request.token}`,
        "X-GitHub-Api-Version": API_VERSION,
      };

      const { repositories, skipped } = selectRepositoriesToScan(
        request.projects,
        maxRepositories,
      );

      const issues: ProviderIssue[] = [];
      let scanned = 0;
      let failed = 0;
      let lastError: ProviderError | null = null;

      for (const repository of repositories) {
        try {
          // `sort=created` keeps the newest first, which is what the dashboard shows.
          const { data, response }: { data: unknown; response: Response } =
            await requestJson<unknown>({
              url: `${API_BASE}/repos/${repository}/issues?state=open&sort=created&direction=desc&per_page=${pageSize}`,
              headers,
              fetchImpl,
              signal: request.signal,
              classifyError: classifyGitHubError,
            });

          if (!Array.isArray(data)) {
            throw new ProviderError(
              "INVALID_RESPONSE",
              "GitHub n'a pas renvoyé une liste d'issues.",
              { status: response.status },
            );
          }

          for (const raw of data as GitHubIssue[]) {
            issues.push(normaliseGitHubIssue(raw, repository));
          }

          scanned += 1;
        } catch (error) {
          // A quota or a revoked token concerns the connection, not one repository:
          // failing the run is better than storing a view that looks complete.
          if (
            error instanceof ProviderError &&
            (error.code === "RATE_LIMITED" || error.code === "UNAUTHORIZED")
          ) {
            throw error;
          }

          if (!(error instanceof ProviderError)) {
            throw error;
          }

          // A renamed, moved or deleted repository must not cost the other ones.
          failed += 1;
          lastError = error;
        }
      }

      // Every repository refused: the run has nothing to report, so it fails and the
      // connection is marked in error instead of publishing an empty issue list.
      if (repositories.length > 0 && scanned === 0 && lastError) {
        throw lastError;
      }

      return {
        supported: true,
        issues,
        fetchedAt: new Date(),
        repositoriesScanned: scanned,
        repositoriesSkipped: skipped,
        repositoriesFailed: failed,
      };
    },
  };
}

export function normaliseGitHubIssue(issue: GitHubIssue, repository: string): ProviderIssue {
  const normalised: ProviderIssue = {
    externalId: String(issue.id ?? ""),
    // Presence of `pull_request` is the only reliable discriminator: the endpoint
    // returns both kinds, and a pull request is not an unanswered report.
    kind: issue.pull_request === undefined || issue.pull_request === null
      ? "ISSUE"
      : "PULL_REQUEST",
    repository,
    number: typeof issue.number === "number" ? issue.number : 0,
    title: typeof issue.title === "string" ? issue.title : "",
    url: typeof issue.html_url === "string" ? issue.html_url : "",
    authorLogin: authorLogin(issue.user),
    commentsCount: typeof issue.comments === "number" ? issue.comments : 0,
    labels: labelNames(issue.labels),
    openedAt: parseProviderInstant(issue.created_at, "GITHUB"),
    activityAt: parseProviderInstant(issue.updated_at, "GITHUB"),
  };

  assertIssueShape(normalised, "GITHUB");
  return normalised;
}

/**
 * The repositories to query first: the most recently pushed ones.
 *
 * A project without a usable push date is sorted last rather than treated as fresh.
 */
export function selectRepositoriesToScan(
  projects: readonly ProviderProject[],
  maxRepositories: number,
): { repositories: string[]; skipped: number } {
  const ordered = [...projects].sort(
    (left, right) => lastPushTime(right) - lastPushTime(left),
  );
  const selected = ordered.slice(0, Math.max(0, maxRepositories));

  return {
    repositories: selected.map((project) => project.name),
    skipped: Math.max(0, ordered.length - selected.length),
  };
}

function lastPushTime(project: ProviderProject): number {
  const value = project.metrics["lastPushAt"];
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;

  return Number.isNaN(parsed) ? 0 : parsed;
}

function authorLogin(user: unknown): string | null {
  if (typeof user !== "object" || user === null) {
    return null;
  }

  const login = (user as { login?: unknown }).login;
  return typeof login === "string" && login.length > 0 ? login : null;
}

/** Labels arrive either as strings or as objects; only the names are displayed. */
function labelNames(labels: unknown): string[] {
  if (!Array.isArray(labels)) {
    return [];
  }

  return labels
    .map((label) =>
      typeof label === "string"
        ? label
        : typeof label === "object" && label !== null
          ? (label as { name?: unknown }).name
          : null,
    )
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .slice(0, MAX_LABELS);
}
