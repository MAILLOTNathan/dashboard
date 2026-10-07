import { describe, expect, it } from "vitest";
import type { AlertCandidate } from "./domain";
import { planAlertChanges, type AlertLifecycleRow } from "./lifecycle";

/** Fictitious data only: the lifecycle is a pure function of rows and candidates. */

function candidate(fingerprint: string, amount = "10.00"): AlertCandidate {
  return {
    kind: "LOW_BALANCE",
    fingerprint,
    inputs: { balance: amount },
  };
}

function row(overrides: Partial<AlertLifecycleRow> & { id: string; fingerprint: string }): AlertLifecycleRow {
  return { status: "ACTIVE", ...overrides };
}

describe("planAlertChanges", () => {
  it("creates an episode for a condition seen for the first time", () => {
    const plan = planAlertChanges([], [candidate("low-balance:a1")]);

    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].fingerprint).toBe("low-balance:a1");
    expect(plan.refreshes).toEqual([]);
    expect(plan.reopens).toEqual([]);
    expect(plan.resolves).toEqual([]);
  });

  it("suppresses the duplicate: a second evaluation refreshes, it does not create", () => {
    const existing = [row({ id: "alert-1", fingerprint: "low-balance:a1" })];
    const plan = planAlertChanges(existing, [candidate("low-balance:a1", "7.00")]);

    expect(plan.creates).toEqual([]);
    expect(plan.refreshes).toHaveLength(1);
    expect(plan.refreshes[0].id).toBe("alert-1");
    // The refreshed inputs are the fresh ones.
    expect(plan.refreshes[0].candidate.inputs.balance).toBe("7.00");
  });

  it("keeps a dismissed alert silenced while the condition holds", () => {
    const existing = [row({ id: "alert-1", fingerprint: "low-balance:a1", status: "DISMISSED" })];
    const plan = planAlertChanges(existing, [candidate("low-balance:a1")]);

    expect(plan.creates).toEqual([]);
    expect(plan.reopens).toEqual([]);
    expect(plan.refreshes.map((entry) => entry.id)).toEqual(["alert-1"]);
    expect(plan.resolves).toEqual([]);
  });

  it("resolves an alert whose condition is gone — dismissed ones too", () => {
    const existing = [
      row({ id: "alert-1", fingerprint: "low-balance:a1" }),
      row({ id: "alert-2", fingerprint: "low-balance:a2", status: "DISMISSED" }),
    ];
    const plan = planAlertChanges(existing, []);

    expect(plan.resolves).toEqual(["alert-1", "alert-2"]);
    expect(plan.creates).toEqual([]);
  });

  it("resolves a dismissed alert so a future re-trigger asks again", () => {
    // First pass: the condition disappears → resolved.
    const existing = [row({ id: "alert-1", fingerprint: "low-balance:a1", status: "DISMISSED" })];
    const resolved = planAlertChanges(existing, []);
    expect(resolved.resolves).toEqual(["alert-1"]);

    // Later, the same condition triggers again: the resolved row reopens.
    const afterResolution = [
      row({ id: "alert-1", fingerprint: "low-balance:a1", status: "RESOLVED" }),
    ];
    const reopened = planAlertChanges(afterResolution, [candidate("low-balance:a1")]);
    expect(reopened.reopens).toHaveLength(1);
    expect(reopened.reopens[0].id).toBe("alert-1");
    expect(reopened.creates).toEqual([]);
  });

  it("never touches a resolved row while it stays resolved", () => {
    const existing = [row({ id: "alert-1", fingerprint: "low-balance:a1", status: "RESOLVED" })];
    const plan = planAlertChanges(existing, []);

    expect(plan.resolves).toEqual([]);
    expect(plan.creates).toEqual([]);
  });

  it("deduplicates candidates sharing a fingerprint within one pass", () => {
    const plan = planAlertChanges([], [candidate("low-balance:a1", "5.00"), candidate("low-balance:a1", "3.00")]);

    expect(plan.creates).toHaveLength(1);
    // The first one wins: a replay of the same pass cannot race its own unique constraint.
    expect(plan.creates[0].inputs.balance).toBe("5.00");
  });

  it("plans a mixed pass in one go", () => {
    const existing = [
      row({ id: "keep", fingerprint: "low-balance:keep" }),
      row({ id: "dismissed", fingerprint: "low-balance:dismissed", status: "DISMISSED" }),
      row({ id: "resolved", fingerprint: "low-balance:resolved", status: "RESOLVED" }),
      row({ id: "gone", fingerprint: "low-balance:gone" }),
    ];
    const candidates = [
      candidate("low-balance:keep"),
      candidate("low-balance:dismissed"),
      candidate("low-balance:resolved"),
      candidate("low-balance:new"),
    ];

    const plan = planAlertChanges(existing, candidates);

    expect(plan.creates.map((entry) => entry.fingerprint)).toEqual(["low-balance:new"]);
    expect(plan.refreshes.map((entry) => entry.id).sort()).toEqual(["dismissed", "keep"]);
    expect(plan.reopens.map((entry) => entry.id)).toEqual(["resolved"]);
    expect(plan.resolves).toEqual(["gone"]);
  });
});
