import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { projectAccountBalance } from "./projection";

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
