import { describe, expect, it } from "vitest";
import {
  connectionInputSchema,
  describeConnectionState,
  describeInstance,
  describeSyncRun,
  formatRunDuration,
  isSyncStale,
  publicInstanceLabel,
  STALE_AFTER_HOURS,
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

describe("isSyncStale", () => {
  const lastSyncedAt = new Date(Date.UTC(2026, 9, 5, 12, 0, 0));

  it("accepts a fresh synchronisation", () => {
    const now = new Date(lastSyncedAt.getTime() + 3 * 3_600_000);
    expect(isSyncStale(lastSyncedAt, now)).toBe(false);
  });

  it("treats exactly the threshold as still fresh: staleness starts after it", () => {
    const now = new Date(lastSyncedAt.getTime() + STALE_AFTER_HOURS * 3_600_000);
    expect(isSyncStale(lastSyncedAt, now)).toBe(false);
  });

  it("reports a synchronisation older than the threshold as stale", () => {
    const now = new Date(
      lastSyncedAt.getTime() + STALE_AFTER_HOURS * 3_600_000 + 1,
    );
    expect(isSyncStale(lastSyncedAt, now)).toBe(true);
  });

  it("honours a custom threshold", () => {
    const now = new Date(lastSyncedAt.getTime() + 48 * 3_600_000);
    expect(isSyncStale(lastSyncedAt, now, 24)).toBe(true);
    expect(isSyncStale(lastSyncedAt, now, 72)).toBe(false);
  });
});

describe("describeSyncRun", () => {
  const baseRun = {
    status: "SUCCESS" as const,
    startedAt: new Date(Date.UTC(2026, 9, 5, 12, 0, 0)),
    fetched: 12,
    skipped: 0,
    failed: 0,
    retries: 0,
    errorSummary: null,
  };

  it("labels a full success as successful", () => {
    expect(describeSyncRun(baseRun)).toEqual({
      label: "Réussie",
      note: null,
      tone: "positive",
    });
  });

  it("does not present an empty success as a quiet victory", () => {
    expect(describeSyncRun({ ...baseRun, fetched: 0 })).toEqual({
      label: "Réussie — rien à lire",
      note: null,
      tone: "neutral",
    });
  });

  it("names the repositories left unread on a partial run", () => {
    expect(describeSyncRun({ ...baseRun, status: "PARTIAL", skipped: 3 })).toEqual({
      label: "Partielle",
      note: "3 dépôt(s) non lu(s) — leurs données restent inconnues",
      tone: "warning",
    });
  });

  it("reports failed repositories and retries", () => {
    const outcome = describeSyncRun({
      ...baseRun,
      status: "PARTIAL",
      failed: 1,
      retries: 2,
    });

    expect(outcome.label).toBe("Partielle");
    expect(outcome.note).toContain("1 dépôt(s) en échec");
    expect(outcome.note).toContain("2 relance(s) après erreur transitoire");
  });

  it("keeps only the safe error summary on a failed run", () => {
    const outcome = describeSyncRun({
      ...baseRun,
      status: "FAILED",
      fetched: 0,
      errorSummary: "RATE_LIMITED (HTTP 403)",
      retries: 1,
    });

    expect(outcome.label).toBe("Échec");
    expect(outcome.tone).toBe("negative");
    expect(outcome.note).toBe(
      "RATE_LIMITED (HTTP 403) · 1 relance(s) après erreur transitoire",
    );
  });

  it("reads a RUNNING row left behind as interrupted, not in progress", () => {
    const now = new Date(baseRun.startedAt.getTime() + 2 * 3_600_000);

    expect(describeSyncRun({ ...baseRun, status: "RUNNING" }, { now })).toEqual({
      label: "Interrompue",
      note: "Le processus s'est arrêté avant la fin de la synchronisation.",
      tone: "warning",
    });
  });
});

describe("formatRunDuration", () => {
  const start = new Date(Date.UTC(2026, 9, 5, 12, 0, 0));

  it("formats seconds, minutes and hours", () => {
    expect(formatRunDuration(start, new Date(start.getTime() + 4_000))).toBe("4 s");
    expect(formatRunDuration(start, new Date(start.getTime() + 65_000))).toBe(
      "1 min 05 s",
    );
    expect(formatRunDuration(start, new Date(start.getTime() + 3_600_000))).toBe("1 h");
    expect(formatRunDuration(start, new Date(start.getTime() + 3_900_000))).toBe(
      "1 h 05",
    );
  });

  it("does not invent a duration for an unfinished run", () => {
    expect(formatRunDuration(start, null)).toBe("en cours");
  });
});
