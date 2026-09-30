/**
 * Label suggestions for the entry form.
 *
 * Re-typing the same label every month is the most repetitive part of keeping a
 * budget, so the form offers the labels already used. The rules live here rather
 * than in the page so they can be checked without a database, and so the browser and
 * the server never disagree about what counts as "the same label".
 */

export type LabelUsage = {
  label: string;
  /** How many transactions carry it. */
  usageCount: number;
  /** Date of the most recent operation carrying it. */
  lastUsedOn: Date;
};

/** Options offered at once. Past this, a list stops being a shortcut. */
export const LABEL_SUGGESTION_LIMIT = 20;

/**
 * What makes two labels the same for a human.
 *
 * Case and inner spacing are typing artefacts: "Courses  du samedi" and "courses du
 * samedi" are one label, and offering them as two lines would hide a distinct label
 * the form could have suggested instead.
 */
function comparisonKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Orders the labels already used, most useful first.
 *
 * Frequency first, recency only as a tie-break: a label used forty times is a better
 * guess than one used once, and the browser filters the list as the label is typed,
 * so the order matters mainly when several candidates match the same prefix.
 *
 * Labels are never rewritten: the spelling kept is the one used most recently, which
 * is the last one the owner actually chose.
 */
export function buildLabelSuggestions(
  usages: readonly LabelUsage[],
  limit: number = LABEL_SUGGESTION_LIMIT,
): string[] {
  if (limit <= 0) {
    return [];
  }

  const merged = new Map<string, LabelUsage>();

  for (const usage of usages) {
    const label = usage.label.trim();

    // An empty option renders as a blank line that looks like a broken suggestion.
    if (label === "") {
      continue;
    }

    const key = comparisonKey(label);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        label,
        usageCount: usage.usageCount,
        lastUsedOn: usage.lastUsedOn,
      });
      continue;
    }

    const isMoreRecent = usage.lastUsedOn.getTime() > existing.lastUsedOn.getTime();

    merged.set(key, {
      label: isMoreRecent ? label : existing.label,
      usageCount: existing.usageCount + usage.usageCount,
      lastUsedOn: isMoreRecent ? usage.lastUsedOn : existing.lastUsedOn,
    });
  }

  return [...merged.values()]
    .sort(
      (left, right) =>
        right.usageCount - left.usageCount ||
        right.lastUsedOn.getTime() - left.lastUsedOn.getTime() ||
        // A stable final order: two labels used once on the same day must not swap
        // places between two renders of the same page.
        left.label.localeCompare(right.label, "fr"),
    )
    .slice(0, limit)
    .map((usage) => usage.label);
}
