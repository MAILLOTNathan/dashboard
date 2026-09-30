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
