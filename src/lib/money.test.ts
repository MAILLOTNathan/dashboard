import { describe, expect, it } from "vitest";
import {
  formatMoney,
  InvalidAmountError,
  parseAmountInput,
  sumMoney,
  type Money,
} from "./money";

describe("parseAmountInput", () => {
  it("accepts a plain integer", () => {
    expect(parseAmountInput("42").toFixed(2)).toBe("42.00");
  });

  it("accepts a French decimal comma", () => {
    expect(parseAmountInput("12,50").toFixed(2)).toBe("12.50");
  });

  it("accepts a dot decimal separator", () => {
    expect(parseAmountInput("12.50").toFixed(2)).toBe("12.50");
  });

  it("accepts a negative amount", () => {
    expect(parseAmountInput("-45,90").toFixed(2)).toBe("-45.90");
  });

  it("accepts an explicit plus sign", () => {
    expect(parseAmountInput("+3,20").toFixed(2)).toBe("3.20");
  });

  it("ignores spaces and non-breaking spaces used as thousand separators", () => {
    expect(parseAmountInput("1 234,56").toFixed(2)).toBe("1234.56");
    expect(parseAmountInput("1\u00A0234,56").toFixed(2)).toBe("1234.56");
  });

  it("treats the dot as a thousands separator when a comma is also present", () => {
    expect(parseAmountInput("1.234,56").toFixed(2)).toBe("1234.56");
  });

  it("accepts a trailing currency symbol", () => {
    expect(parseAmountInput("12,50 €").toFixed(2)).toBe("12.50");
  });

  it("keeps the exact value, without floating point drift", () => {
    // 0.1 + 0.2 in binary floating point is not 0.3; decimals must not care.
    expect(parseAmountInput("0,1").plus(parseAmountInput("0,2")).toFixed(2)).toBe("0.30");
  });

  it("rejects an empty value", () => {
    expect(() => parseAmountInput("")).toThrow(InvalidAmountError);
  });

  it("rejects a sign with no digits", () => {
    expect(() => parseAmountInput("-")).toThrow(InvalidAmountError);
  });

  it("rejects text", () => {
    expect(() => parseAmountInput("douze")).toThrow(InvalidAmountError);
  });

  it("rejects more than two decimals instead of rounding silently", () => {
    expect(() => parseAmountInput("12,345")).toThrow(InvalidAmountError);
  });

  it("rejects a lone thousands separator", () => {
    expect(() => parseAmountInput("1.234")).toThrow(InvalidAmountError);
  });
});

describe("sumMoney", () => {
  it("adds amounts of the same currency", () => {
    const values: Money[] = [
      { amount: parseAmountInput("10,10"), currency: "EUR" },
      { amount: parseAmountInput("0,20"), currency: "EUR" },
    ];

    expect(sumMoney(values).amount.toFixed(2)).toBe("10.30");
  });

  it("returns zero for an empty list", () => {
    expect(sumMoney([]).amount.toFixed(2)).toBe("0.00");
  });

  it("refuses to add two different currencies", () => {
    const values: Money[] = [
      { amount: parseAmountInput("10"), currency: "EUR" },
      { amount: parseAmountInput("10"), currency: "USD" },
    ];

    expect(() => sumMoney(values)).toThrow(/Cannot sum USD and EUR/);
  });
});

describe("formatMoney", () => {
  it("formats an amount in euros for a French locale", () => {
    const formatted = formatMoney({ amount: parseAmountInput("-1234,5"), currency: "EUR" });

    // The exact glyphs depend on the ICU data; the sign, the amount and the
    // currency must be unambiguous.
    expect(formatted).toContain("1");
    expect(formatted).toContain("234");
    expect(formatted).toMatch(/-/);
    expect(formatted).toContain("€");
  });

  it("always shows two decimals", () => {
    expect(formatMoney({ amount: parseAmountInput("7"), currency: "EUR" })).toMatch(/7,00/);
  });
});
