import { describe, expect, it } from "vitest";
import { ProviderError } from "./adapter";
import { createGitHubAdapter, nextPageUrl, normaliseGitHubRepository } from "./github";

/**
 * Adapter tests.
 *
 * Every test injects a fake `fetch`: no test performs a real network call, and
 * no test needs a real token.
 */
function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

type Handler = (url: string, init?: RequestInit) => Response;

function queueFetch(handlers: Handler[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });

    const handler = handlers.shift();
    if (!handler) {
      throw new Error(`Unexpected extra request: ${url}`);
    }
    return handler(url, init);
  }) as typeof fetch;

  return { impl, calls };
}

const FICTITIOUS_REPO = {
  id: 1234,
  full_name: "example-owner/example-project",
  html_url: "https://github.com/example-owner/example-project",
  private: true,
  default_branch: "main",
  language: "TypeScript",
  stargazers_count: 3,
  open_issues_count: 1,
  pushed_at: "2026-09-29T10:00:00Z",
};

describe("createGitHubAdapter — nominal case", () => {
  it("normalises a repository and keeps only the fields the interface needs", async () => {
    const { impl } = queueFetch([() => jsonResponse([FICTITIOUS_REPO])]);

    const outcome = await createGitHubAdapter().listProjects({
      token: "fictitious-token",
      instanceUrl: "",
      owner: null,
      fetchImpl: impl,
    });

    expect(outcome.projects).toHaveLength(1);
    expect(outcome.projects[0]).toEqual({
      externalId: "1234",
      externalUrl: "https://github.com/example-owner/example-project",
      name: "example-owner/example-project",
      visibility: "private",
      metrics: {
        defaultBranch: "main",
        language: "TypeScript",
        stars: 3,
        openIssues: 1,
        lastPushAt: "2026-09-29T10:00:00Z",
      },
    });
    expect(outcome.fetchedAt).toBeInstanceOf(Date);
  });

  it("sends the token in a header and never in the URL", async () => {
    const { impl, calls } = queueFetch([() => jsonResponse([])]);

    await createGitHubAdapter().listProjects({
      token: "fictitious-token",
      instanceUrl: "",
      owner: null,
      fetchImpl: impl,
    });

    const [call] = calls;
    expect(call.url).not.toContain("fictitious-token");
    expect((call.init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer fictitious-token",
    );
  });

  it("lists the organisation repositories when an owner is configured", async () => {
    const { impl, calls } = queueFetch([() => jsonResponse([])]);

    await createGitHubAdapter().listProjects({
      token: "fictitious-token",
      instanceUrl: "",
      owner: "example-org",
      fetchImpl: impl,
    });

    expect(calls[0].url).toContain("/orgs/example-org/repos");
  });

  it("follows the pagination link and stops on the last page", async () => {
    const { impl, calls } = queueFetch([
      () =>
        jsonResponse([FICTITIOUS_REPO], {
          headers: {
            link: '<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=2>; rel="last"',
          },
        }),
      () => jsonResponse([{ ...FICTITIOUS_REPO, id: 5678 }]),
    ]);

    const outcome = await createGitHubAdapter().listProjects({
      token: "fictitious-token",
      instanceUrl: "",
      owner: null,
      fetchImpl: impl,
    });

    expect(outcome.projects.map((project) => project.externalId)).toEqual(["1234", "5678"]);
    expect(calls).toHaveLength(2);
  });

  it("never exceeds the page budget", async () => {
    const alwaysNext: Handler = () =>
      jsonResponse([FICTITIOUS_REPO], {
        headers: { link: '<https://api.github.com/user/repos?page=2>; rel="next"' },
      });

    const { impl, calls } = queueFetch([alwaysNext, alwaysNext, alwaysNext]);

    await createGitHubAdapter().listProjects({
      token: "fictitious-token",
      instanceUrl: "",
      owner: null,
      fetchImpl: impl,
      maxPages: 2,
    });

    expect(calls).toHaveLength(2);
  });
});

describe("createGitHubAdapter — error cases", () => {
  it("maps a 401 to UNAUTHORIZED", async () => {
    const { impl } = queueFetch([() => jsonResponse({ message: "Bad credentials" }, { status: 401 })]);

    await expect(
      createGitHubAdapter().listProjects({
        token: "revoked-token",
        instanceUrl: "",
        owner: null,
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("maps an exhausted quota to RATE_LIMITED, not to a generic failure", async () => {
    const { impl } = queueFetch([
      () =>
        jsonResponse(
          { message: "API rate limit exceeded" },
          {
            status: 403,
            headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1" },
          },
        ),
    ]);

    await expect(
      createGitHubAdapter().listProjects({
        token: "fictitious-token",
        instanceUrl: "",
        owner: null,
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("maps an unknown organisation to NOT_FOUND", async () => {
    const { impl } = queueFetch([() => jsonResponse({ message: "Not Found" }, { status: 404 })]);

    await expect(
      createGitHubAdapter().listProjects({
        token: "fictitious-token",
        instanceUrl: "",
        owner: "unknown-org",
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps a server error to HTTP_ERROR", async () => {
    const { impl } = queueFetch([() => jsonResponse({ message: "boom" }, { status: 502 })]);

    await expect(
      createGitHubAdapter().listProjects({
        token: "fictitious-token",
        instanceUrl: "",
        owner: null,
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ code: "HTTP_ERROR", details: { status: 502 } });
  });

  it("maps an unreadable body to INVALID_RESPONSE", async () => {
    const { impl } = queueFetch([
      () => new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
    ]);

    await expect(
      createGitHubAdapter().listProjects({
        token: "fictitious-token",
        instanceUrl: "",
        owner: null,
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a payload that is not a list of repositories", async () => {
    const { impl } = queueFetch([() => jsonResponse({ message: "unexpected shape" })]);

    await expect(
      createGitHubAdapter().listProjects({
        token: "fictitious-token",
        instanceUrl: "",
        owner: null,
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a repository without a usable identity", () => {
    expect(() =>
      normaliseGitHubRepository({ id: 1, html_url: "https://example.test" }),
    ).toThrow(ProviderError);
  });

  it("maps a transport failure to NETWORK", async () => {
    const { impl } = queueFetch([
      () => {
        throw new TypeError("fetch failed");
      },
    ]);

    await expect(
      createGitHubAdapter().listProjects({
        token: "fictitious-token",
        instanceUrl: "",
        owner: null,
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("never leaks the token through the persisted error message", async () => {
    const { impl } = queueFetch([() => jsonResponse({ message: "Bad credentials" }, { status: 401 })]);

    try {
      await createGitHubAdapter().listProjects({
        token: "super-secret-token",
        instanceUrl: "",
        owner: null,
        fetchImpl: impl,
      });
      expect.unreachable("the adapter should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).toSafeMessage()).toBe("UNAUTHORIZED (HTTP 401)");
      expect((error as ProviderError).toSafeMessage()).not.toContain("super-secret-token");
    }
  });
});

describe("nextPageUrl", () => {
  it("returns null without a Link header", () => {
    expect(nextPageUrl(null)).toBeNull();
  });

  it("returns null when only previous and last are announced", () => {
    expect(
      nextPageUrl('<https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?page=9>; rel="last"'),
    ).toBeNull();
  });

  it("extracts the next page URL", () => {
    expect(nextPageUrl('<https://api.github.com/x?page=3>; rel="next"')).toBe(
      "https://api.github.com/x?page=3",
    );
  });
});

/** Fictitious issues only: no real repository, title or contributor. */
const FICTITIOUS_ISSUE = {
  id: 900001,
  number: 42,
  title: "Le total mensuel ignore les remboursements",
  html_url: "https://github.com/example-owner/example-project/issues/42",
  comments: 0,
  created_at: "2026-09-27T08:00:00Z",
  updated_at: "2026-09-29T09:30:00Z",
  labels: [{ name: "bug" }, "budget"],
  user: { login: "contributor-one" },
};

const FICTITIOUS_PULL_REQUEST = {
  ...FICTITIOUS_ISSUE,
  id: 900002,
  number: 43,
  title: "Corrige le calcul des remboursements",
  html_url: "https://github.com/example-owner/example-project/pull/43",
  comments: 2,
  pull_request: { url: "https://api.github.com/repos/example-owner/example-project/pulls/43" },
};

function project(name: string, lastPushAt: string) {
  return {
    externalId: name,
    externalUrl: `https://github.com/${name}`,
    name,
    visibility: "private",
    metrics: { lastPushAt },
  };
}

function listIssuesRequest(projects: ReturnType<typeof project>[], impl: typeof fetch, extra = {}) {
  return {
    token: "fictitious-token",
    instanceUrl: "",
    owner: null,
    projects,
    fetchImpl: impl,
    ...extra,
  };
}

describe("createGitHubAdapter — issues", () => {
  it("normalises open issues and tells pull requests apart", async () => {
    const { impl, calls } = queueFetch([
      () => jsonResponse([FICTITIOUS_ISSUE, FICTITIOUS_PULL_REQUEST]),
    ]);

    const outcome = await createGitHubAdapter().listIssues(
      listIssuesRequest([project("example-owner/example-project", "2026-09-29T10:00:00Z")], impl),
    );

    expect(calls[0].url).toContain("/repos/example-owner/example-project/issues?state=open");
    expect(calls[0].url).toContain("sort=created");
    expect(outcome.supported).toBe(true);
    expect(outcome.repositoriesScanned).toBe(1);
    expect(outcome.repositoriesSkipped).toBe(0);
    expect(outcome.repositoriesFailed).toBe(0);
    expect(outcome.issues[0]).toEqual({
      externalId: "900001",
      kind: "ISSUE",
      repository: "example-owner/example-project",
      number: 42,
      title: "Le total mensuel ignore les remboursements",
      url: "https://github.com/example-owner/example-project/issues/42",
      authorLogin: "contributor-one",
      commentsCount: 0,
      // Labels mix strings and objects in the same payload; only names are kept.
      labels: ["bug", "budget"],
      openedAt: new Date("2026-09-27T08:00:00Z"),
      activityAt: new Date("2026-09-29T09:30:00Z"),
    });
    // The endpoint returns both kinds: the discriminator is the pull_request key.
    expect(outcome.issues[1].kind).toBe("PULL_REQUEST");
  });

  it("queries the most recently pushed repositories first, and reports the rest as not read", async () => {
    const { impl, calls } = queueFetch([() => jsonResponse([]), () => jsonResponse([])]);

    const outcome = await createGitHubAdapter().listIssues(
      listIssuesRequest(
        [
          project("example-owner/quiet", "2025-01-05T10:00:00Z"),
          project("example-owner/busy", "2026-09-30T10:00:00Z"),
          project("example-owner/middle", "2026-08-01T10:00:00Z"),
        ],
        impl,
        { maxRepositories: 2 },
      ),
    );

    expect(calls.map((call) => call.url)).toEqual([
      expect.stringContaining("/repos/example-owner/busy/issues"),
      expect.stringContaining("/repos/example-owner/middle/issues"),
    ]);
    expect(outcome.repositoriesScanned).toBe(2);
    // Not read is not "nothing open": the count travels with the result.
    expect(outcome.repositoriesSkipped).toBe(1);
  });

  it("keeps the other repositories when one is refused", async () => {
    const { impl } = queueFetch([
      () => jsonResponse({ message: "Not Found" }, { status: 404 }),
      () => jsonResponse([FICTITIOUS_ISSUE]),
    ]);

    const outcome = await createGitHubAdapter().listIssues(
      listIssuesRequest(
        [
          project("example-owner/renamed", "2026-09-30T10:00:00Z"),
          project("example-owner/example-project", "2026-09-29T10:00:00Z"),
        ],
        impl,
      ),
    );

    expect(outcome.issues).toHaveLength(1);
    expect(outcome.repositoriesScanned).toBe(1);
    expect(outcome.repositoriesFailed).toBe(1);
  });

  it("fails the run when every repository is refused, instead of publishing an empty list", async () => {
    const { impl } = queueFetch([
      () => jsonResponse({ message: "Not Found" }, { status: 404 }),
      () => jsonResponse({ message: "Not Found" }, { status: 404 }),
    ]);

    await expect(
      createGitHubAdapter().listIssues(
        listIssuesRequest(
          [
            project("example-owner/renamed", "2026-09-30T10:00:00Z"),
            project("example-owner/moved", "2026-09-30T09:00:00Z"),
          ],
          impl,
        ),
      ),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("fails the run on a rate limit: a partial view must not look complete", async () => {
    const { impl, calls } = queueFetch([
      () =>
        jsonResponse(
          { message: "API rate limit exceeded" },
          { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1893456000" } },
        ),
    ]);

    await expect(
      createGitHubAdapter().listIssues(
        listIssuesRequest(
          [
            project("example-owner/one", "2026-09-30T10:00:00Z"),
            project("example-owner/two", "2026-09-29T10:00:00Z"),
          ],
          impl,
        ),
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    // It stops at the first refusal rather than hammering the remaining repositories.
    expect(calls).toHaveLength(1);
  });

  it("rejects an issue without a readable date instead of dating it now", async () => {
    const { impl } = queueFetch([
      () => jsonResponse([{ ...FICTITIOUS_ISSUE, created_at: null }]),
    ]);

    await expect(
      createGitHubAdapter().listIssues(
        listIssuesRequest([project("example-owner/example-project", "2026-09-30T10:00:00Z")], impl),
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a title-less issue rather than storing a blank row", async () => {
    const { impl } = queueFetch([() => jsonResponse([{ ...FICTITIOUS_ISSUE, title: "" }])]);

    await expect(
      createGitHubAdapter().listIssues(
        listIssuesRequest([project("example-owner/example-project", "2026-09-30T10:00:00Z")], impl),
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("makes no request when there is no repository to inspect", async () => {
    const { impl, calls } = queueFetch([]);

    const outcome = await createGitHubAdapter().listIssues(listIssuesRequest([], impl));

    expect(calls).toHaveLength(0);
    expect(outcome.issues).toEqual([]);
    expect(outcome.repositoriesScanned).toBe(0);
  });

  it("never sends the token in the URL of an issue request", async () => {
    const { impl, calls } = queueFetch([() => jsonResponse([])]);

    await createGitHubAdapter().listIssues(
      listIssuesRequest([project("example-owner/example-project", "2026-09-30T10:00:00Z")], impl),
    );

    expect(calls[0].url).not.toContain("fictitious-token");
    expect((calls[0].init?.headers as Record<string, string>)["PRIVATE-TOKEN"]).toBeUndefined();
  });
});
