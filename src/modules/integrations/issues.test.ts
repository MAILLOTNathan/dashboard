import { describe, expect, it } from "vitest";
import {
  ageInDays,
  computeIssueHighlights,
  isRecent,
  isStale,
  isUnanswered,
  sortIssuesByRecency,
  type IssueLike,
} from "./issues";

/**
 * Fictitious issues only: never a real repository, a real title or a real author.
 *
 * `now` is fixed so the rules are tested against a frozen clock, not against the
 * machine's date.
 */
const NOW = new Date("2026-09-30T12:00:00Z");

function daysAgo(days: number, hours = 0): Date {
  return new Date(NOW.getTime() - days * 86_400_000 - hours * 3_600_000);
}

function issue(overrides: Partial<IssueLike> & { id?: string } = {}): IssueLike & { id: string } {
  return {
    id: overrides.id ?? "issue-1",
    kind: overrides.kind ?? "ISSUE",
    openedAt: overrides.openedAt ?? daysAgo(1),
    commentsCount: overrides.commentsCount ?? 0,
  };
}

describe("ageInDays", () => {
  it("floors to whole days", () => {
    expect(ageInDays(daysAgo(3, 23), NOW)).toBe(3);
  });

  it("is zero for an issue opened a few hours ago", () => {
    expect(ageInDays(daysAgo(0, 4), NOW)).toBe(0);
  });
});

describe("isRecent", () => {
  it("counts an issue opened inside the window", () => {
    expect(isRecent(issue({ openedAt: daysAgo(3) }), NOW, 14)).toBe(true);
  });

  it("excludes an issue opened before the window", () => {
    expect(isRecent(issue({ openedAt: daysAgo(20) }), NOW, 14)).toBe(false);
  });

  it("treats the boundary as the first excluded day", () => {
    expect(isRecent(issue({ openedAt: daysAgo(14) }), NOW, 14)).toBe(false);
  });
});

describe("isUnanswered", () => {
  it("counts an issue nobody commented on", () => {
    expect(isUnanswered(issue({ openedAt: daysAgo(5) }), NOW, 3)).toBe(true);
  });

  it("does not count an issue that received a comment", () => {
    expect(isUnanswered(issue({ openedAt: daysAgo(5), commentsCount: 1 }), NOW, 3)).toBe(false);
  });

  it("leaves a grace period before calling an issue unanswered", () => {
    expect(isUnanswered(issue({ openedAt: daysAgo(1) }), NOW, 3)).toBe(false);
  });

  it("never counts a pull request as unanswered, even with no comment", () => {
    expect(isUnanswered(issue({ kind: "PULL_REQUEST", openedAt: daysAgo(10) }), NOW, 3)).toBe(
      false,
    );
  });
});

describe("isStale", () => {
  it("counts an old issue", () => {
    expect(isStale(issue({ openedAt: daysAgo(120) }), NOW, 90)).toBe(true);
  });

  it("never reports a pull request as stale", () => {
    expect(isStale(issue({ kind: "PULL_REQUEST", openedAt: daysAgo(120) }), NOW, 90)).toBe(false);
  });
});

describe("computeIssueHighlights", () => {
  it("returns zeros and no oldest issue for an empty list", () => {
    const highlights = computeIssueHighlights([], { now: NOW });

    expect(highlights).toMatchObject({
      total: 0,
      recent: 0,
      unanswered: 0,
      pullRequests: 0,
      stale: 0,
      oldestOpen: null,
    });
  });

  it("counts each category independently on the same list", () => {
    const highlights = computeIssueHighlights(
      [
        issue({ id: "new-today", openedAt: daysAgo(0, 2) }),
        issue({ id: "forgotten", openedAt: daysAgo(9) }),
        issue({ id: "old-timer", openedAt: daysAgo(200) }),
        issue({
          id: "answered",
          openedAt: daysAgo(30),
          commentsCount: 4,
        }),
        issue({ id: "review", kind: "PULL_REQUEST", openedAt: daysAgo(1), commentsCount: 0 }),
      ],
      { now: NOW },
    );

    expect(highlights.total).toBe(5);
    // "Recent" is about when it arrived, whatever its kind: the review counts too,
    // and so does the forgotten issue (9 days old, still inside the 14-day window).
    expect(highlights.recent).toBe(3); // new-today, forgotten, review
    expect(highlights.unanswered).toBe(2); // forgotten, old-timer
    expect(highlights.pullRequests).toBe(1);
    expect(highlights.stale).toBe(1); // old-timer
    expect(highlights.recentDays).toBe(14);
    expect(highlights.unansweredDays).toBe(3);
    expect(highlights.staleDays).toBe(90);
  });

  it("reports the oldest open issue with its age, ignoring pull requests", () => {
    const highlights = computeIssueHighlights(
      [
        issue({ id: "recent", openedAt: daysAgo(2) }),
        issue({ id: "oldest", openedAt: daysAgo(45) }),
        issue({ id: "old-pull-request", kind: "PULL_REQUEST", openedAt: daysAgo(300) }),
      ],
      { now: NOW },
    );

    expect(highlights.oldestOpen?.issue.id).toBe("oldest");
    expect(highlights.oldestOpen?.ageDays).toBe(45);
  });

  it("accepts custom thresholds", () => {
    const highlights = computeIssueHighlights([issue({ openedAt: daysAgo(10) })], {
      now: NOW,
      recentDays: 30,
      unansweredDays: 1,
      staleDays: 7,
    });

    expect(highlights.recent).toBe(1);
    expect(highlights.unanswered).toBe(1);
    expect(highlights.stale).toBe(1);
  });

  it("keeps the caller's own fields on the oldest issue", () => {
    const stored = {
      ...issue({ id: "with-url", openedAt: daysAgo(5) }),
      url: "https://github.com/example-owner/example-project/issues/7",
      repository: "example-owner/example-project",
    };

    const highlights = computeIssueHighlights([stored], { now: NOW });

    // The rules are structural, so a row read back from the database keeps its own
    // fields: the page needs the link, not just the dates.
    expect(highlights.oldestOpen?.issue.url).toBe(
      "https://github.com/example-owner/example-project/issues/7",
    );
  });
});

describe("sortIssuesByRecency", () => {
  it("orders newest first without mutating the input", () => {
    const input = [
      issue({ id: "middle", openedAt: daysAgo(5) }),
      issue({ id: "oldest", openedAt: daysAgo(30) }),
      issue({ id: "newest", openedAt: daysAgo(1) }),
    ];

    const sorted = sortIssuesByRecency(input);

    expect(sorted.map((entry) => entry.id)).toEqual(["newest", "middle", "oldest"]);
    expect(input.map((entry) => entry.id)).toEqual(["middle", "oldest", "newest"]);
  });
});
