import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  defaultTransferLabels,
  signedTransferLegs,
  TRANSFER_GROUP_DELETE_LABEL,
  transferLegEditRefusedReason,
} from "./transfers";

describe("defaultTransferLabels", () => {
  it("reads well on both account statements", () => {
    expect(defaultTransferLabels("Compte courant", "Livret A")).toEqual({
      source: "Virement vers Livret A",
      destination: "Virement depuis Compte courant",
    });
  });
});

describe("signedTransferLegs", () => {
  it("writes the source leg negative and the destination positive", () => {
    const legs = signedTransferLegs(new Decimal("300.00"));

    expect(legs.out.toFixed(2)).toBe("-300.00");
    expect(legs.in.toFixed(2)).toBe("300.00");
    // Both legs are the same money: the pair nets to zero on the owner's position.
    expect(legs.out.plus(legs.in).toFixed(2)).toBe("0.00");
  });
});

describe("transferLegEditRefusedReason", () => {
  it("leaves a single-leg transfer editable", () => {
    expect(transferLegEditRefusedReason(null)).toBeNull();
  });

  it("refuses editing one half of a linked transfer", () => {
    expect(transferLegEditRefusedReason("group-1")).toMatch(/virement entre comptes/);
  });

  it("names the group deletion in its confirmation text", () => {
    expect(TRANSFER_GROUP_DELETE_LABEL).toMatch(/2 mouvements/);
  });
});
