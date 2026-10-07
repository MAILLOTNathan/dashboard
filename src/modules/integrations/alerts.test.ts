import { describe, expect, it } from "vitest";
import type { AlertRuleConfig } from "@/modules/alerts/domain";
import { evaluateStaleIntegration } from "./alerts";
import type { ConnectionSummary } from "./domain";

/** Fictitious data only, with a fixed clock. */

const NOW = new Date(Date.UTC(2026, 9, 6, 12, 0));

function rule(overrides: Partial<AlertRuleConfig> = {}): AlertRuleConfig {
  return {
    kind: "STALE_INTEGRATION",
    enabled: true,
    thresholdAmount: null,
    thresholdCurrency: null,
    thresholdPercent: null,
    thresholdDays: 1,
    ...overrides,
  };
}

function connection(overrides: Partial<ConnectionSummary> = {}): ConnectionSummary {
  return {
    id: "connection-1",
    provider: "GITHUB",
    instanceUrl: "",
    externalOwner: "owner",
    permissions: [],
    status: "CONNECTED",
    lastSyncedAt: new Date(Date.UTC(2026, 9, 4, 12, 0)),
    lastSyncError: null,
    hasStoredToken: true,
    projectCount: 3,
    issueCount: 2,
    milestoneCount: 0,
    ...overrides,
  };
}

describe("evaluateStaleIntegration", () => {
  it("triggers when the last success is older than the threshold", () => {
    const candidates = evaluateStaleIntegration([connection()], rule(), { now: NOW });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].fingerprint).toBe("stale-integration:connection-1");
    expect(candidates[0].inputs.daysSince).toBe("2");
    expect(candidates[0].inputs.thresholdDays).toBe("1");
    // The public instance label, not an empty string.
    expect(candidates[0].inputs.instance).toBe("github.com");
    expect(candidates[0].inputs.lastSyncedAt).toBe("2026-10-04T12:00:00.000Z");
  });

  it("does not trigger at the boundary: exactly the threshold old is not stale", () => {
    const exactlyOneDay = connection({ lastSyncedAt: new Date(Date.UTC(2026, 9, 5, 12, 0)) });

    expect(evaluateStaleIntegration([exactlyOneDay], rule(), { now: NOW })).toEqual([]);
  });

  it("does not trigger on a fresh synchronisation", () => {
    const fresh = connection({ lastSyncedAt: new Date(Date.UTC(2026, 9, 6, 11, 0)) });

    expect(evaluateStaleIntegration([fresh], rule(), { now: NOW })).toEqual([]);
  });

  it("leaves a never-synchronised connection alone: missing is not stale", () => {
    const never = connection({ lastSyncedAt: null, status: "NOT_CONNECTED" });

    expect(evaluateStaleIntegration([never], rule(), { now: NOW })).toEqual([]);
  });

  it("honours a raised threshold", () => {
    const fiveDays = rule({ thresholdDays: 5 });

    expect(evaluateStaleIntegration([connection()], fiveDays, { now: NOW })).toEqual([]);
  });

  it("stays quiet when disabled", () => {
    expect(
      evaluateStaleIntegration([connection()], rule({ enabled: false }), { now: NOW }),
    ).toEqual([]);
  });
});
