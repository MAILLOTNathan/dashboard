import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { Currency } from "@/lib/money";
import { buildSimulatedBalances, projectAccountBalance } from "./projection";

/** Fictitious values only. */
const recorded = (transactionCount: number, balance: string) => ({
  transactionCount,
  balance: new Decimal(balance),
});

describe("projectAccountBalance", () => {
  it("adds the pending occurrences to the recorded balance, expense negative", () => {
    const projection = projectAccountBalance({
      recorded: recorded(12, "1500.00"),
      pending: [
        { type: "EXPENSE", amount: new Decimal("950.00") },
        { type: "INCOME", amount: new Decimal("200.00") },
      ],
    });

    expect(projection.kind).toBe("KNOWN");
    if (projection.kind === "KNOWN") {
      expect(projection.projected.toFixed(2)).toBe("750.00");
      expect(projection.pendingNet.toFixed(2)).toBe("-750.00");
      expect(projection.pendingCount).toBe(2);
    }
  });

  it("with nothing pending, the projection equals the recorded balance", () => {
    const projection = projectAccountBalance({
      recorded: recorded(3, "120.00"),
      pending: [],
    });

    expect(projection.kind === "KNOWN" && projection.projected.toFixed(2)).toBe("120.00");
    expect(projection.pendingCount).toBe(0);
  });

  it("stays unknown without a recorded transaction: a starting balance is not a zero", () => {
    const projection = projectAccountBalance({
      recorded: recorded(0, "0.00"),
      pending: [{ type: "EXPENSE", amount: new Decimal("950.00") }],
    });

    expect(projection.kind).toBe("UNKNOWN");
    if (projection.kind === "UNKNOWN") {
      expect(projection.reason).toMatch(/inconnu/);
      // The pending net is still told — only the projection is refused.
      expect(projection.pendingNet.toFixed(2)).toBe("-950.00");
    }
  });

  it("keeps a real zero balance known: recorded rows exist, the net is zero", () => {
    const projection = projectAccountBalance({
      recorded: recorded(2, "0.00"),
      pending: [],
    });

    expect(projection.kind).toBe("KNOWN");
    expect(projection.kind === "KNOWN" && projection.projected.toFixed(2)).toBe("0.00");
  });
});

describe("buildSimulatedBalances", () => {
  const eur = (value: string) => new Decimal(value);
  /** Currency-keyed maps, like the repository reads produce. */
  const amounts = (...entries: [Currency, Decimal][]) => new Map<Currency, Decimal>(entries);

  it("advances the recorded base with recorded and pending movements, month by month", () => {
    // November: the salary is booked (461,25 € recorded) and the series are still pending
    // (-1 000 €) — the booked salary must not be added a second time as a pending figure.
    const months = [
      {
        key: "2026-11",
        recorded: amounts(["EUR", eur("461.25")]),
        pending: amounts(["EUR", eur("-1000")]),
      },
      {
        key: "2026-12",
        recorded: amounts(),
        pending: amounts(["EUR", eur("-692.50")]),
      },
    ];
    const result = buildSimulatedBalances({
      recordedBefore: amounts(["EUR", eur("2679.60")]),
      months,
    });

    expect(result[0]?.balances.get("EUR")?.toFixed(2)).toBe("2140.85");
    expect(result[1]?.balances.get("EUR")?.toFixed(2)).toBe("1448.35");
  });

  it("knows a currency whose first recorded operation is inside the window", () => {
    const result = buildSimulatedBalances({
      recordedBefore: amounts(),
      months: [
        { key: "2026-11", recorded: amounts(["USD", eur("100")]), pending: amounts() },
      ],
    });

    expect(result[0]?.balances.get("USD")?.toFixed(2)).toBe("100.00");
  });

  it("leaves an unrecorded currency absent from the balances — not a zero", () => {
    const result = buildSimulatedBalances({
      recordedBefore: amounts(),
      months: [
        { key: "2026-11", recorded: amounts(), pending: amounts(["EUR", eur("-1000")]) },
      ],
    });

    expect(result[0]?.balances.has("EUR")).toBe(false);
  });

  it("keeps a currency advancing through a month with no row, without mutating snapshots", () => {
    const months = [
      {
        key: "2026-11",
        recorded: amounts(["USD", eur("100")]),
        pending: amounts(),
      },
      { key: "2026-12", recorded: amounts(), pending: amounts(["USD", eur("20")]) },
    ];
    const result = buildSimulatedBalances({ recordedBefore: amounts(), months });

    expect(result[1]?.balances.get("USD")?.toFixed(2)).toBe("120.00");
    // A later month's copy is independent: editing it cannot rewrite November.
    result[1]?.balances.set("USD", eur("999"));
    expect(result[0]?.balances.get("USD")?.toFixed(2)).toBe("100.00");
  });
});
