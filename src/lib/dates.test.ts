import { describe, expect, it } from "vitest";
import {
  currentMonthKey,
  formatMonthLabel,
  formatDateOnly,
  InvalidDateError,
  isValidTimeZone,
  monthRange,
  parseDateOnly,
  parseMonthKey,
  toDateOnlyString,
} from "./dates";

describe("parseDateOnly", () => {
  it("parses a calendar day at UTC midnight", () => {
    const parsed = parseDateOnly("2026-09-30");

    expect(parsed.toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("round-trips with toDateOnlyString", () => {
    expect(toDateOnlyString(parseDateOnly("2026-01-01"))).toBe("2026-01-01");
  });

  it("rejects a wrong format", () => {
    expect(() => parseDateOnly("30/09/2026")).toThrow(InvalidDateError);
  });

  it("rejects an impossible day instead of rolling over to the next month", () => {
    expect(() => parseDateOnly("2026-02-31")).toThrow(InvalidDateError);
  });

  it("rejects the 31st of a 30-day month", () => {
    expect(() => parseDateOnly("2026-04-31")).toThrow(InvalidDateError);
  });
});

describe("monthRange", () => {
  it("starts on the first day of the month and ends on the first day of the next", () => {
    const range = monthRange(2026, 9);

    expect(range.start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("uses an exclusive upper bound, so the first of next month is never included", () => {
    const range = monthRange(2026, 9);
    const firstOfNextMonth = parseDateOnly("2026-10-01");

    expect(firstOfNextMonth.getTime() >= range.start.getTime()).toBe(true);
    expect(firstOfNextMonth.getTime() < range.end.getTime()).toBe(false);
  });

  it("crosses the year boundary in December", () => {
    const range = monthRange(2026, 12);

    expect(range.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("handles a leap February", () => {
    expect(monthRange(2028, 2).end.toISOString()).toBe("2028-03-01T00:00:00.000Z");
  });

  it("rejects an invalid month", () => {
    expect(() => monthRange(2026, 13)).toThrow(RangeError);
    expect(() => monthRange(2026, 0)).toThrow(RangeError);
  });

  it("rejects an invalid year", () => {
    expect(() => monthRange(1900, 1)).toThrow(RangeError);
  });
});

describe("month keys", () => {
  it("derives the current month key", () => {
    expect(currentMonthKey(new Date(Date.UTC(2026, 8, 30)))).toBe("2026-09");
  });

  it("parses a month key", () => {
    expect(parseMonthKey("2026-09")).toMatchObject({ year: 2026, month: 9 });
  });

  it("rejects a malformed month key", () => {
    expect(() => parseMonthKey("2026-9")).toThrow(RangeError);
    expect(() => parseMonthKey("septembre")).toThrow(RangeError);
  });

  it("rejects a month key with an impossible month", () => {
    expect(() => parseMonthKey("2026-13")).toThrow(RangeError);
  });

  it("labels a month in French", () => {
    expect(formatMonthLabel(2026, 9)).toMatch(/septembre/i);
  });
});

describe("date-only formatting", () => {
  it("formats without shifting the day, whatever the local time zone", () => {
    // A date-only value is UTC midnight; displayed in a negative-offset zone it
    // must still read as the 30th.
    expect(formatDateOnly(parseDateOnly("2026-09-30"))).toContain("30");
  });
});

describe("isValidTimeZone", () => {
  it("accepts a known zone", () => {
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
  });

  it("rejects an unknown zone", () => {
    expect(isValidTimeZone("Europe/Atlantis")).toBe(false);
  });
});
