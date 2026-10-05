import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError, type IntegrationAdapter } from "@/modules/integrations/adapter";

const findConnectionForSyncMock = vi.fn();
const listConnectionsMock = vi.fn();
const startSyncRunMock = vi.fn();
const finishSyncRunMock = vi.fn();
const markSyncSuccessMock = vi.fn();
const markSyncFailureMock = vi.fn();
const saveSnapshotsMock = vi.fn();
const saveIssuesMock = vi.fn();
const saveMilestonesMock = vi.fn();
const listProjectsMock = vi.fn();
const listIssuesMock = vi.fn();
const listMilestonesMock = vi.fn();

vi.mock("@/modules/integrations/repository", () => ({
  findConnectionForSync: (...args: unknown[]) => findConnectionForSyncMock(...args),
  listConnections: (...args: unknown[]) => listConnectionsMock(...args),
  startSyncRun: (...args: unknown[]) => startSyncRunMock(...args),
  finishSyncRun: (...args: unknown[]) => finishSyncRunMock(...args),
  markSyncSuccess: (...args: unknown[]) => markSyncSuccessMock(...args),
  markSyncFailure: (...args: unknown[]) => markSyncFailureMock(...args),
  saveSnapshots: (...args: unknown[]) => saveSnapshotsMock(...args),
  saveIssues: (...args: unknown[]) => saveIssuesMock(...args),
  saveMilestones: (...args: unknown[]) => saveMilestonesMock(...args),
}));

vi.mock("@/modules/integrations/github", () => ({
  createGitHubAdapter: (): IntegrationAdapter => ({
    provider: "GITHUB",
    requiredScopes: [],
    tracksIssues: true,
    tracksMilestones: true,
    listProjects: (...args: unknown[]) => listProjectsMock(...args),
    listIssues: (...args: unknown[]) => listIssuesMock(...args),
    listMilestones: (...args: unknown[]) => listMilestonesMock(...args),
  }),
}));

vi.mock("@/modules/integrations/gitlab", () => ({
  createGitLabAdapter: (): IntegrationAdapter => ({
    provider: "GITLAB",
    requiredScopes: [],
    tracksIssues: false,
    tracksMilestones: false,
    listProjects: (...args: unknown[]) => listProjectsMock(...args),
    listIssues: (...args: unknown[]) => listIssuesMock(...args),
    listMilestones: (...args: unknown[]) => listMilestonesMock(...args),
  }),
}));

const { synchroniseConnection } = await import("./sync");

/**
 * Fictitious identifiers only. The run lifecycle is tested against mocked
 * repository and adapter modules: no test touches a database or the network.
 */
const CONNECTION = {
  id: "connection-1",
  userId: "owner-1",
  provider: "GITHUB" as const,
  instanceUrl: "",
  externalOwner: null,
  token: "ghp_fictitious_token",
};

const FETCHED_AT = new Date(Date.UTC(2026, 9, 5, 10, 0, 0));
const PROJECT_OUTCOME = {
  projects: [
    { externalId: "p1", externalUrl: "https://example.test/p1", name: "owner/one", visibility: null, metrics: {} },
    { externalId: "p2", externalUrl: "https://example.test/p2", name: "owner/two", visibility: null, metrics: {} },
  ],
  fetchedAt: FETCHED_AT,
};
const ISSUE_OUTCOME = {
  supported: true,
  issues: [{ externalId: "issue-1" }],
  fetchedAt: FETCHED_AT,
  repositoriesScanned: 2,
  repositoriesSkipped: 0,
  repositoriesFailed: 0,
};
const MILESTONE_OUTCOME = {
  supported: true,
  milestones: [],
  fetchedAt: FETCHED_AT,
  repositoriesScanned: 2,
  repositoriesSkipped: 0,
  repositoriesFailed: 0,
};

describe("synchroniseConnection run history", () => {
  beforeEach(() => {
    findConnectionForSyncMock.mockReset().mockResolvedValue(CONNECTION);
    startSyncRunMock.mockReset().mockResolvedValue("run-1");
    finishSyncRunMock.mockReset().mockResolvedValue(undefined);
    markSyncSuccessMock.mockReset().mockResolvedValue(undefined);
    markSyncFailureMock.mockReset().mockResolvedValue(undefined);
    saveSnapshotsMock.mockReset().mockResolvedValue({ created: 1, updated: 1 });
    saveIssuesMock.mockReset().mockResolvedValue({ created: 0, updated: 1 });
    saveMilestonesMock.mockReset().mockResolvedValue({ created: 1, updated: 0 });
    listProjectsMock.mockReset().mockResolvedValue(PROJECT_OUTCOME);
    listIssuesMock.mockReset().mockResolvedValue(ISSUE_OUTCOME);
    listMilestonesMock.mockReset().mockResolvedValue(MILESTONE_OUTCOME);
  });

  it("records a successful run with its counters", async () => {
    const result = await synchroniseConnection("owner-1", "connection-1");

    expect(result).toMatchObject({
      status: "SYNCHRONISED",
      projectCount: 2,
      issueCount: 1,
      milestoneCount: 0,
      retries: 0,
    });
    expect(startSyncRunMock).toHaveBeenCalledWith("connection-1");
    expect(finishSyncRunMock).toHaveBeenCalledWith("run-1", {
      status: "SUCCESS",
      // 2 projects + 1 issue + 0 milestones read; 1 + 0 + 1 created; 1 + 1 + 0 updated.
      fetched: 3,
      created: 2,
      updated: 2,
      skipped: 0,
      failed: 0,
      retries: 0,
    });
    expect(markSyncSuccessMock).toHaveBeenCalledWith("connection-1", FETCHED_AT);
  });

  it("closes the run as partial when repositories were left unread", async () => {
    listIssuesMock.mockResolvedValue({
      ...ISSUE_OUTCOME,
      repositoriesScanned: 1,
      repositoriesSkipped: 1,
    });

    const result = await synchroniseConnection("owner-1", "connection-1");

    expect(result).toMatchObject({ status: "SYNCHRONISED", issuesSkippedRepositories: 1 });
    expect(finishSyncRunMock).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "PARTIAL", skipped: 1 }),
    );
    // A partial read is still a successful synchronisation for the freshness display.
    expect(markSyncSuccessMock).toHaveBeenCalled();
  });

  it("counts a repository failure reported by the milestone scan", async () => {
    listMilestonesMock.mockResolvedValue({
      ...MILESTONE_OUTCOME,
      repositoriesScanned: 1,
      repositoriesFailed: 1,
    });

    await synchroniseConnection("owner-1", "connection-1");

    expect(finishSyncRunMock).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "PARTIAL", failed: 1 }),
    );
  });

  it("records a failed run and persists only the safe message", async () => {
    listProjectsMock.mockRejectedValue(
      new ProviderError("HTTP_ERROR", "boom ghp_fictitious_token", { status: 502 }),
    );

    const result = await synchroniseConnection("owner-1", "connection-1");

    expect(result).toEqual({
      connectionId: "connection-1",
      provider: "GITHUB",
      status: "FAILED",
      code: "HTTP_ERROR (HTTP 502)",
    });
    expect(markSyncFailureMock).toHaveBeenCalledWith("connection-1", "HTTP_ERROR (HTTP 502)");
    expect(finishSyncRunMock).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "FAILED", errorSummary: "HTTP_ERROR (HTTP 502)" }),
    );
    // Nothing persisted may quote the provider message or the token.
    const persisted = JSON.stringify(finishSyncRunMock.mock.calls);
    expect(persisted).not.toContain("ghp_fictitious_token");
    expect(persisted).not.toContain("boom");
  });

  it("retries transient failures and reports the retry count", async () => {
    // The stub adapter goes through the wrapped fetch, like the real adapters do.
    listProjectsMock.mockImplementationOnce(
      async (request: { fetchImpl: typeof fetch }) => {
        await request.fetchImpl("https://api.example.test/repos");
        return PROJECT_OUTCOME;
      },
    );
    const respondingFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const result = await synchroniseConnection("owner-1", "connection-1", {
      fetchImpl: respondingFetch as unknown as typeof fetch,
      sleep: async () => {},
      random: () => 0.5,
    });

    expect(respondingFetch).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "SYNCHRONISED", retries: 1 });
    expect(finishSyncRunMock).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ retries: 1 }),
    );
  });

  it("does not open a run when the connection is missing", async () => {
    findConnectionForSyncMock.mockResolvedValue(null);

    const result = await synchroniseConnection("owner-1", "gone");

    expect(result).toEqual({
      connectionId: "gone",
      provider: "GITHUB",
      status: "SKIPPED",
      reason: "NOT_FOUND",
    });
    expect(startSyncRunMock).not.toHaveBeenCalled();
  });

  it("does not open a run when the stored token cannot be read", async () => {
    findConnectionForSyncMock.mockResolvedValue({ ...CONNECTION, token: null });

    const result = await synchroniseConnection("owner-1", "connection-1");

    expect(result).toMatchObject({ status: "SKIPPED", reason: "NO_TOKEN" });
    expect(startSyncRunMock).not.toHaveBeenCalled();
  });
});
