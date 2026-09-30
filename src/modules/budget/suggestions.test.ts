import { describe, expect, it } from "vitest";
import {
  buildLabelSuggestions,
  LABEL_SUGGESTION_LIMIT,
  type LabelUsage,
} from "./suggestions";

/** Fictitious labels only. */
function usage(label: string, usageCount: number, day: number): LabelUsage {
  return { label, usageCount, lastUsedOn: new Date(Date.UTC(2026, 8, day)) };
}

describe("buildLabelSuggestions", () => {
  it("ranks by how often a label was used, not by how recent it is", () => {
    // Forty entries against one: the monthly rent is a better guess than a gift
    // bought yesterday, and the browser filters the rest as the label is typed.
    const suggestions = buildLabelSuggestions([
      usage("Cadeau anniversaire", 1, 28),
      usage("Loyer", 40, 1),
    ]);

    expect(suggestions).toEqual(["Loyer", "Cadeau anniversaire"]);
  });

  it("breaks a tie with the most recent use, then alphabetically", () => {
    const suggestions = buildLabelSuggestions([
      usage("Essence", 3, 2),
      usage("Péage", 3, 25),
      usage("Autoroute", 3, 25),
    ]);

    // Same count: the two used most recently come first, in a stable order.
    expect(suggestions).toEqual(["Autoroute", "Péage", "Essence"]);
  });

  it("merges labels that differ only in case or inner spacing", () => {
    // To a human these are one label, and showing three near-identical lines would
    // hide the third distinct label the form could have offered.
    const suggestions = buildLabelSuggestions([
      usage("Courses  du samedi", 2, 1),
      usage("courses du samedi", 3, 15),
      usage("COURSES DU SAMEDI", 2, 20),
    ]);

    expect(suggestions).toHaveLength(1);
  });

  it("keeps the spelling of the most recent occurrence", () => {
    const suggestions = buildLabelSuggestions([
      usage("courses du samedi", 3, 1),
      usage("Courses du samedi", 1, 20),
    ]);

    expect(suggestions).toEqual(["Courses du samedi"]);
  });

  it("sums the counts of the merged spellings when ranking", () => {
    const suggestions = buildLabelSuggestions([
      usage("loyer", 2, 1),
      usage("Loyer", 2, 2),
      usage("Essence", 3, 3),
    ]);

    // Four uses of the rent against three of fuel: the merge must count, or the
    // ranking would contradict what the table shows.
    expect(suggestions).toEqual(["Loyer", "Essence"]);
  });

  it("ignores blank labels, trimmed or not", () => {
    const suggestions = buildLabelSuggestions([
      usage("", 5, 1),
      usage("   ", 2, 2),
      usage("Loyer", 1, 3),
    ]);

    expect(suggestions).toEqual(["Loyer"]);
  });

  it("caps the list at the default limit", () => {
    const many = Array.from({ length: LABEL_SUGGESTION_LIMIT + 10 }, (_, index) =>
      usage(`Libellé ${index}`, 1, 1),
    );

    expect(buildLabelSuggestions(many)).toHaveLength(LABEL_SUGGESTION_LIMIT);
  });

  it("honours an explicit limit, keeping the most used labels", () => {
    const suggestions = buildLabelSuggestions(
      [usage("Rare", 1, 1), usage("Fréquent", 9, 1), usage("Moyen", 4, 1)],
      2,
    );

    expect(suggestions).toEqual(["Fréquent", "Moyen"]);
  });

  it("offers nothing when the limit is zero or negative", () => {
    // A form that asks for no suggestion must not receive the whole history.
    expect(buildLabelSuggestions([usage("Loyer", 3, 1)], 0)).toEqual([]);
    expect(buildLabelSuggestions([usage("Loyer", 3, 1)], -5)).toEqual([]);
  });

  it("returns nothing for an empty history", () => {
    expect(buildLabelSuggestions([])).toEqual([]);
  });

  it("never returns a duplicate", () => {
    const suggestions = buildLabelSuggestions([
      usage("Loyer", 1, 1),
      usage("loyer", 1, 2),
      usage(" Loyer ", 1, 3),
    ]);

    expect(new Set(suggestions).size).toBe(suggestions.length);
  });
});
