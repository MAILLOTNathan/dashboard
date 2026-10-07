import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { AlertRuleConfig } from "@/modules/alerts/domain";
import { evaluateOverdueEvent, type DueCashflow } from "./alerts";

/** Fictitious data only, with a fixed clock. */

const NOW = new Date(Date.UTC(2026, 9, 6, 9, 0)); // 2026-10-06

function rule(overrides: Partial<AlertRuleConfig> = {}): AlertRuleConfig {
  return {
    kind: "OVERDUE_EVENT",
    enabled: true,
    thresholdAmount: null,
    thresholdCurrency: null,
    thresholdPercent: null,
    thresholdDays: 0,
    ...overrides,
  };
}

function entry(overrides: Partial<DueCashflow> = {}): DueCashflow {
  return {
    id: "cashflow-1",
    propertyId: "property-1",
    propertyName: "Rez-de-chaussée",
    label: "Loyer",
    kind: "INCOME",
    currency: "EUR",
    amount: new Decimal("950"),
    dueDate: new Date(Date.UTC(2026, 8, 15)), // 2026-09-15
    settledAt: null,
    ...overrides,
  };
}

describe("evaluateOverdueEvent", () => {
  it("triggers on an unsettled past due date and counts the days late", () => {
    const candidates = evaluateOverdueEvent([entry()], rule(), { now: NOW });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].fingerprint).toBe("overdue-event:cashflow-1");
    expect(candidates[0].inputs.daysLate).toBe("21");
    expect(candidates[0].inputs.dueDate).toBe("2026-09-15");
    expect(candidates[0].inputs.amount).toBe("950.00");
    expect(candidates[0].inputs.propertyName).toBe("Rez-de-chaussée");
  });

  it("does not trigger on the due date itself: due today is not late", () => {
    const today = entry({ dueDate: new Date(Date.UTC(2026, 9, 6)) });

    expect(evaluateOverdueEvent([today], rule(), { now: NOW })).toEqual([]);
  });

  it("does not trigger on a future due date", () => {
    const future = entry({ dueDate: new Date(Date.UTC(2026, 10, 1)) });

    expect(evaluateOverdueEvent([future], rule(), { now: NOW })).toEqual([]);
  });

  it("does not trigger once the entry is settled", () => {
    const settled = entry({ settledAt: new Date(Date.UTC(2026, 8, 20)) });

    expect(evaluateOverdueEvent([settled], rule(), { now: NOW })).toEqual([]);
  });

  it("ignores entries without a due date", () => {
    expect(evaluateOverdueEvent([entry({ dueDate: null })], rule(), { now: NOW })).toEqual([]);
  });

  it("applies the grace period strictly: the boundary day is still covered", () => {
    const grace7 = rule({ thresholdDays: 7 });

    // Late by exactly 7 days: covered by a 7-day grace.
    const exactlySeven = entry({ dueDate: new Date(Date.UTC(2026, 8, 29)) });
    expect(evaluateOverdueEvent([exactlySeven], grace7, { now: NOW })).toEqual([]);

    // Late by 8 days: past the grace.
    const eight = entry({ dueDate: new Date(Date.UTC(2026, 8, 28)) });
    const candidates = evaluateOverdueEvent([eight], grace7, { now: NOW });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].inputs.daysLate).toBe("8");
    expect(candidates[0].inputs.thresholdDays).toBe("7");
  });

  it("keeps an unresolved entry, recording that the amount is unknown", () => {
    const unresolved = entry({ amount: null });

    const candidates = evaluateOverdueEvent([unresolved], rule(), { now: NOW });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].inputs.amount).toBeNull();
  });

  it("stays quiet when disabled", () => {
    expect(evaluateOverdueEvent([entry()], rule({ enabled: false }), { now: NOW })).toEqual([]);
  });
});
