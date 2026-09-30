import { describe, expect, it } from "vitest";
import {
  describeMilestoneDue,
  isMilestoneOpen,
  milestoneProgress,
  sortMilestones,
  type MilestoneLike,
} from "./milestones";

/** Fictitious milestones only. */
const NOW = new Date("2026-09-30T12:00:00Z");

function milestone(overrides: Partial<MilestoneLike> = {}): MilestoneLike & { id: string } {
  return {
    id: overrides.title ?? "m-1",
    title: overrides.title ?? "Jalon de test",
    state: overrides.state ?? "open",
    dueOn: overrides.dueOn ?? null,
    issuesOpen: overrides.issuesOpen ?? 0,
    issuesClosed: overrides.issuesClosed ?? 0,
  };
}

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 86_400_000);
}

describe("milestoneProgress", () => {
  it("reports the share of closed items", () => {
    expect(milestoneProgress(milestone({ issuesOpen: 3, issuesClosed: 1 }))).toBeCloseTo(0.25, 5);
  });

  it("reports zero for an empty milestone rather than a misleading 100 %", () => {
    expect(milestoneProgress(milestone({ issuesOpen: 0, issuesClosed: 0 }))).toBe(0);
  });

  it("reports 1 when everything is closed", () => {
    expect(
      milestoneProgress(milestone({ state: "closed", issuesOpen: 0, issuesClosed: 4 })),
    ).toBe(1);
  });
});

describe("describeMilestoneDue", () => {
  it("says nothing without a due date", () => {
    expect(describeMilestoneDue(milestone(), NOW)).toEqual({ kind: "none" });
  });

  it("counts an overdue open milestone", () => {
    expect(describeMilestoneDue(milestone({ dueOn: daysFromNow(-5) }), NOW)).toEqual({
      kind: "overdue",
      days: 5,
    });
  });

  it("recognises the due day itself", () => {
    expect(describeMilestoneDue(milestone({ dueOn: NOW }), NOW)).toEqual({ kind: "today" });
  });

  it("counts the days left", () => {
    expect(describeMilestoneDue(milestone({ dueOn: daysFromNow(12) }), NOW)).toEqual({
      kind: "upcoming",
      days: 12,
    });
  });

  it("never calls a closed milestone late: its date is history", () => {
    expect(
      describeMilestoneDue(milestone({ state: "closed", dueOn: daysFromNow(-90) }), NOW),
    ).toEqual({ kind: "none" });
  });
});

describe("sortMilestones", () => {
  it("puts what is still to do first, soonest due date first", () => {
    const sorted = sortMilestones([
      milestone({ title: "Livré", state: "closed", dueOn: daysFromNow(-60) }),
      milestone({ title: "Plus tard", dueOn: daysFromNow(30) }),
      milestone({ title: "Bientôt", dueOn: daysFromNow(3) }),
    ]);

    expect(sorted.map((entry) => entry.title)).toEqual(["Bientôt", "Plus tard", "Livré"]);
  });

  it("sorts undated milestones last, not first", () => {
    const sorted = sortMilestones([
      milestone({ title: "Sans échéance" }),
      milestone({ title: "Daté", dueOn: daysFromNow(10) }),
    ]);

    expect(sorted.map((entry) => entry.title)).toEqual(["Daté", "Sans échéance"]);
  });

  it("shows closed milestones most recently due first", () => {
    const sorted = sortMilestones([
      milestone({ title: "Ancien", state: "closed", dueOn: daysFromNow(-300) }),
      milestone({ title: "Récent", state: "closed", dueOn: daysFromNow(-10) }),
    ]);

    expect(sorted.map((entry) => entry.title)).toEqual(["Récent", "Ancien"]);
  });

  it("breaks a tie on the title so the order never moves", () => {
    const sorted = sortMilestones([
      milestone({ title: "Zêta" }),
      milestone({ title: "Alpha" }),
    ]);

    expect(sorted.map((entry) => entry.title)).toEqual(["Alpha", "Zêta"]);
  });

  it("does not mutate the input", () => {
    const input = [milestone({ title: "B" }), milestone({ title: "A" })];

    sortMilestones(input);

    expect(input.map((entry) => entry.title)).toEqual(["B", "A"]);
  });
});

describe("isMilestoneOpen", () => {
  it("treats anything that is not \"closed\" as not open", () => {
    expect(isMilestoneOpen({ state: "open" })).toBe(true);
    expect(isMilestoneOpen({ state: "closed" })).toBe(false);
    expect(isMilestoneOpen({ state: "unknown" })).toBe(false);
  });
});
