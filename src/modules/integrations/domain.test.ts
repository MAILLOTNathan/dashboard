import { describe, expect, it } from "vitest";
import {
  connectionInputSchema,
  describeConnectionState,
  describeInstance,
  publicInstanceLabel,
} from "./domain";

describe("describeConnectionState", () => {
  it("reports NOT_CONNECTED when nothing has been configured", () => {
    expect(
      describeConnectionState({
        status: "NOT_CONNECTED",
        lastSyncedAt: null,
        lastSyncError: null,
        projectCount: 0,
      }),
    ).toEqual({ kind: "NOT_CONNECTED" });
  });

  it("reports NEVER_SYNCED when a connection exists but has never run", () => {
    expect(
      describeConnectionState({
        status: "CONNECTED",
        lastSyncedAt: null,
        lastSyncError: null,
        projectCount: 0,
      }),
    ).toEqual({ kind: "NEVER_SYNCED" });
  });

  it("reports CONNECTED with the project count and the last successful date", () => {
    const lastSyncedAt = new Date(Date.UTC(2026, 8, 30));

    expect(
      describeConnectionState({
        status: "CONNECTED",
        lastSyncedAt,
        lastSyncError: null,
        projectCount: 4,
      }),
    ).toEqual({ kind: "CONNECTED", lastSyncedAt, projectCount: 4 });
  });

  it("keeps the last successful date when a synchronisation fails", () => {
    // A failure must not erase the previous success and must not display a zero.
    const lastSyncedAt = new Date(Date.UTC(2026, 8, 29));

    expect(
      describeConnectionState({
        status: "ERROR",
        lastSyncedAt,
        lastSyncError: "RATE_LIMITED (HTTP 403)",
        projectCount: 4,
      }),
    ).toEqual({
      kind: "ERROR",
      lastSyncError: "RATE_LIMITED (HTTP 403)",
      lastSyncedAt,
    });
  });
});

describe("instance labels", () => {
  it("names the public instances", () => {
    expect(publicInstanceLabel("GITHUB")).toBe("github.com");
    expect(publicInstanceLabel("GITLAB")).toBe("gitlab.com");
  });

  it("prefers a configured self-hosted URL", () => {
    expect(describeInstance("GITLAB", "https://gitlab.example.com")).toBe(
      "https://gitlab.example.com",
    );
  });

  it("falls back to the public host for an empty URL", () => {
    expect(describeInstance("GITLAB", "")).toBe("gitlab.com");
  });
});

describe("connectionInputSchema", () => {
  it("accepts a minimal GitLab connection", () => {
    const result = connectionInputSchema.safeParse({
      provider: "GITLAB",
      instanceUrl: "",
      token: "glpat-fictitious",
    });

    expect(result.success).toBe(true);
    expect(result.data?.externalOwner).toBeNull();
  });

  it("normalises a trailing slash so the same instance cannot be stored twice", () => {
    const result = connectionInputSchema.safeParse({
      provider: "GITLAB",
      instanceUrl: "https://gitlab.example.com/",
      token: "glpat-fictitious",
    });

    expect(result.data?.instanceUrl).toBe("https://gitlab.example.com");
  });

  it("rejects an instance URL without a scheme", () => {
    const result = connectionInputSchema.safeParse({
      provider: "GITLAB",
      instanceUrl: "gitlab.example.com",
      token: "glpat-fictitious",
    });

    expect(result.success).toBe(false);
  });

  it("requires a token", () => {
    const result = connectionInputSchema.safeParse({
      provider: "GITHUB",
      instanceUrl: "",
      token: "",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unknown provider", () => {
    const result = connectionInputSchema.safeParse({
      provider: "BITBUCKET",
      instanceUrl: "",
      token: "fictitious",
    });

    expect(result.success).toBe(false);
  });
});
