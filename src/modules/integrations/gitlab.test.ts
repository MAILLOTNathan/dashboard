import { describe, expect, it } from "vitest";
import {
  createGitLabAdapter,
  nextPageNumber,
  resolveInstanceBase,
} from "./gitlab";

/** No real GitLab instance and no real token is ever contacted here. */
function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function queueFetch(handlers: Array<(url: string, init?: RequestInit) => Response>) {
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

const FICTITIOUS_PROJECT = {
  id: 42,
  path_with_namespace: "example-group/example-project",
  web_url: "https://gitlab.example.com/example-group/example-project",
  visibility: "private",
  default_branch: "main",
  star_count: 2,
  forks_count: 1,
  open_issues_count: 4,
  last_activity_at: "2026-09-28T12:00:00Z",
};

describe("resolveInstanceBase", () => {
  it("falls back to the public instance when no URL is configured", () => {
    expect(resolveInstanceBase("")).toBe("https://gitlab.com");
  });

  it("normalises a self-hosted URL and drops the trailing slash", () => {
    expect(resolveInstanceBase("https://gitlab.example.com/")).toBe(
      "https://gitlab.example.com",
    );
  });

  it("keeps a sub-path used by some self-hosted instances", () => {
    expect(resolveInstanceBase("https://example.com/gitlab")).toBe(
      "https://example.com/gitlab",
    );
  });

  it("rejects a URL without a scheme", () => {
    expect(() => resolveInstanceBase("gitlab.example.com")).toThrow();
  });
});

describe("createGitLabAdapter — nominal case", () => {
  it("normalises a project from a self-hosted instance", async () => {
    const { impl, calls } = queueFetch([() => jsonResponse([FICTITIOUS_PROJECT])]);

    const outcome = await createGitLabAdapter().listProjects({
      token: "fictitious-token",
      instanceUrl: "https://gitlab.example.com/",
      owner: null,
      fetchImpl: impl,
    });

    expect(calls[0].url).toBe(
      "https://gitlab.example.com/api/v4/projects?per_page=100&page=1&simple=true",
    );
    expect(outcome.projects[0]).toEqual({
      externalId: "42",
      externalUrl: "https://gitlab.example.com/example-group/example-project",
      name: "example-group/example-project",
      visibility: "private",
      metrics: {
        defaultBranch: "main",
        stars: 2,
        forks: 1,
        openIssues: 4,
        lastActivityAt: "2026-09-28T12:00:00Z",
      },
    });
  });

  it("sends the token in the PRIVATE-TOKEN header, never in the URL", async () => {
    const { impl, calls } = queueFetch([() => jsonResponse([])]);

    await createGitLabAdapter().listProjects({
      token: "fictitious-token",
      instanceUrl: "",
      owner: null,
      fetchImpl: impl,
    });

    expect(calls[0].url).not.toContain("fictitious-token");
    expect((calls[0].init?.headers as Record<string, string>)["PRIVATE-TOKEN"]).toBe(
      "fictitious-token",
    );
  });

  it("lists the projects of a tracked group, including sub-group paths", async () => {
    const { impl, calls } = queueFetch([() => jsonResponse([])]);

    await createGitLabAdapter().listProjects({
      token: "fictitious-token",
      instanceUrl: "https://gitlab.com",
      owner: "parent-group/child-group",
      fetchImpl: impl,
    });

    expect(calls[0].url).toContain("/api/v4/groups/parent-group%2Fchild-group/projects");
  });

  it("follows x-next-page until it disappears", async () => {
    const { impl, calls } = queueFetch([
      () => jsonResponse([FICTITIOUS_PROJECT], { headers: { "x-next-page": "2" } }),
      () => jsonResponse([{ ...FICTITIOUS_PROJECT, id: 43 }], { headers: { "x-next-page": "" } }),
    ]);

    const outcome = await createGitLabAdapter().listProjects({
      token: "fictitious-token",
      instanceUrl: "",
      owner: null,
      fetchImpl: impl,
    });

    expect(outcome.projects.map((project) => project.externalId)).toEqual(["42", "43"]);
    expect(calls).toHaveLength(2);
  });
});

describe("createGitLabAdapter — error cases", () => {
  it("maps a refused token to UNAUTHORIZED and mentions the required scope", async () => {
    const { impl } = queueFetch([() => jsonResponse({ message: "401 Unauthorized" }, { status: 401 })]);

    await expect(
      createGitLabAdapter().listProjects({
        token: "expired-token",
        instanceUrl: "",
        owner: null,
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("maps an insufficient scope (403) to UNAUTHORIZED", async () => {
    const { impl } = queueFetch([() => jsonResponse({ message: "Forbidden" }, { status: 403 })]);

    try {
      await createGitLabAdapter().listProjects({
        token: "read-only-without-scope",
        instanceUrl: "",
        owner: null,
        fetchImpl: impl,
      });
      expect.unreachable("the adapter should have thrown");
    } catch (error) {
      expect(error).toMatchObject({ code: "UNAUTHORIZED" });
      expect((error as Error).message).toContain("read_api");
    }
  });

  it("maps a throttle (429) to RATE_LIMITED with the retry delay", async () => {
    const { impl } = queueFetch([
      () => jsonResponse({ message: "Too Many Requests" }, { status: 429, headers: { "retry-after": "30" } }),
    ]);

    await expect(
      createGitLabAdapter().listProjects({
        token: "fictitious-token",
        instanceUrl: "",
        owner: null,
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", details: { retryAfterSeconds: 30 } });
  });

  it("maps an unreachable instance to NETWORK", async () => {
    const { impl } = queueFetch([
      () => {
        throw new TypeError("fetch failed");
      },
    ]);

    await expect(
      createGitLabAdapter().listProjects({
        token: "fictitious-token",
        instanceUrl: "https://gitlab.example.com",
        owner: null,
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("rejects a payload that is not a list of projects", async () => {
    const { impl } = queueFetch([() => jsonResponse({ message: "unexpected shape" })]);

    await expect(
      createGitLabAdapter().listProjects({
        token: "fictitious-token",
        instanceUrl: "",
        owner: null,
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a project without a usable identity", async () => {
    const { impl } = queueFetch([() => jsonResponse([{ id: 7 }])]);

    await expect(
      createGitLabAdapter().listProjects({
        token: "fictitious-token",
        instanceUrl: "",
        owner: null,
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("nextPageNumber", () => {
  it("returns null without a header", () => {
    expect(nextPageNumber(null)).toBeNull();
  });

  it("returns null for an empty header, which marks the last page", () => {
    expect(nextPageNumber("")).toBeNull();
  });

  it("returns the next page number", () => {
    expect(nextPageNumber("3")).toBe(3);
  });

  it("ignores a non-numeric header", () => {
    expect(nextPageNumber("later")).toBeNull();
  });
});
