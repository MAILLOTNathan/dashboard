import { describe, expect, it } from "vitest";
import {
  ageInDays,
  collectIssueFilterOptions,
  computeIssueHighlights,
  FILTER_NONE,
  filterIssues,
  isRecent,
  isStale,
  isUnanswered,
  sortIssuesByRecency,
  summariseByRepository,
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

describe("filterIssues", () => {
  /** A small fixture with every dimension the explorer filters on. */
  function row(overrides: {
    id: string;
    repository?: string;
    kind?: IssueLike["kind"];
    openedAt?: Date;
    commentsCount?: number;
    assignees?: string[];
    labels?: string[];
    milestone?: string | null;
    title?: string;
  }) {
    return {
      id: overrides.id,
      repository: overrides.repository ?? "example-org/api",
      kind: overrides.kind ?? ("ISSUE" as const),
      openedAt: overrides.openedAt ?? daysAgo(2),
      commentsCount: overrides.commentsCount ?? 0,
      assignees: overrides.assignees ?? [],
      labels: overrides.labels ?? [],
      milestone: overrides.milestone ?? null,
      title: overrides.title ?? "Un titre",
    };
  }

  const rows = [
    row({
      id: "unassigned-old",
      openedAt: daysAgo(120),
      title: "Export cassé",
      labels: ["bug"],
    }),
    row({
      id: "assigned-fresh-pr",
      kind: "PULL_REQUEST",
      openedAt: daysAgo(1),
      commentsCount: 4,
      assignees: ["alice"],
      milestone: "V1",
      title: "Refonte du tableau",
      repository: "example-org/site",
    }),
    row({
      id: "assigned-answered",
      openedAt: daysAgo(30),
      commentsCount: 3,
      assignees: ["bob", "alice"],
      labels: ["urgent"],
      milestone: "V1",
      title: "Lenteur sur les totaux",
    }),
  ];

  it("returns everything without a filter, newest first", () => {
    const result = filterIssues(rows, {}, { now: NOW });

    expect(result.map((entry) => entry.id)).toEqual([
      "assigned-fresh-pr",
      "assigned-answered",
      "unassigned-old",
    ]);
  });

  it("treats an empty filter value as no constraint, never as an impossible one", () => {
    const result = filterIssues(
      rows,
      { repository: "", kind: undefined, assignee: "", label: "", milestone: "", query: "" },
      { now: NOW },
    );

    expect(result).toHaveLength(3);
  });

  it("filters by repository, kind, assignee and label together", () => {
    expect(filterIssues(rows, { repository: "example-org/site" }, { now: NOW })).toHaveLength(1);
    expect(filterIssues(rows, { kind: "PULL_REQUEST" }, { now: NOW })).toHaveLength(1);
    expect(
      filterIssues(rows, { assignee: "alice", label: "urgent" }, { now: NOW }).map((r) => r.id),
    ).toEqual(["assigned-answered"]);
  });

  it("matches an issue assigned to anyone when several assignees answer to the filter", () => {
    expect(filterIssues(rows, { assignee: "bob" }, { now: NOW }).map((r) => r.id)).toEqual([
      "assigned-answered",
    ]);
  });

  it("filters the issues nobody is assigned to", () => {
    expect(
      filterIssues(rows, { assignee: FILTER_NONE }, { now: NOW }).map((r) => r.id),
    ).toEqual(["unassigned-old"]);
  });

  it("filters by milestone, and the ones without one", () => {
    expect(filterIssues(rows, { milestone: "V1" }, { now: NOW })).toHaveLength(2);
    expect(
      filterIssues(rows, { milestone: FILTER_NONE }, { now: NOW }).map((r) => r.id),
    ).toEqual(["unassigned-old"]);
  });

  it("searches the title without caring about case", () => {
    expect(
      filterIssues(rows, { query: "export" }, { now: NOW }).map((r) => r.id),
    ).toEqual(["unassigned-old"]);
  });

  it("reuses the same definitions as the badges for its flags", () => {
    // 120 days open with no comment: stale, unanswered, and unassigned.
    expect(
      filterIssues(rows, { flags: ["stale"] }, { now: NOW }).map((r) => r.id),
    ).toEqual(["unassigned-old"]);
    expect(
      filterIssues(rows, { flags: ["unanswered"] }, { now: NOW }).map((r) => r.id),
    ).toEqual(["unassigned-old"]);
    expect(
      filterIssues(rows, { flags: ["recent"] }, { now: NOW }).map((r) => r.id),
    ).toEqual(["assigned-fresh-pr"]);
    expect(
      filterIssues(rows, { flags: ["unassigned"] }, { now: NOW }).map((r) => r.id),
    ).toEqual(["unassigned-old"]);
  });

  it("combines several flags as an intersection", () => {
    // Recent and unanswered cannot both hold: the grace period excludes it.
    expect(filterIssues(rows, { flags: ["recent", "unanswered"] }, { now: NOW })).toEqual([]);
  });

  it("sorts by oldest, by comments and by activity", () => {
    expect(filterIssues(rows, { sort: "oldest" }, { now: NOW }).map((r) => r.id)).toEqual([
      "unassigned-old",
      "assigned-answered",
      "assigned-fresh-pr",
    ]);
    expect(filterIssues(rows, { sort: "comments" }, { now: NOW }).map((r) => r.id)).toEqual([
      "assigned-fresh-pr",
      "assigned-answered",
      "unassigned-old",
    ]);
  });

  it("does not mutate the list it filters", () => {
    const input = [...rows];

    filterIssues(input, { sort: "oldest" }, { now: NOW });

    expect(input.map((entry) => entry.id)).toEqual(rows.map((entry) => entry.id));
  });
});

describe("collectIssueFilterOptions", () => {
  it("lists what is actually present, and whether \"none\" is worth offering", () => {
    const options = collectIssueFilterOptions([
      {
        kind: "ISSUE",
        openedAt: daysAgo(1),
        commentsCount: 0,
        repository: "example-org/b",
        title: "B",
        labels: ["bug", "ui"],
        assignees: ["alice"],
        milestone: "V1",
      },
      {
        kind: "ISSUE",
        openedAt: daysAgo(2),
        commentsCount: 1,
        repository: "example-org/a",
        title: "A",
        labels: ["bug"],
        assignees: [],
        milestone: null,
      },
    ]);

    expect(options.repositories).toEqual(["example-org/a", "example-org/b"]);
    expect(options.assignees).toEqual(["alice"]);
    expect(options.labels).toEqual(["bug", "ui"]);
    expect(options.milestones).toEqual(["V1"]);
    // Both "none" options are useful: some rows have no assignee and no milestone.
    expect(options.hasUnassigned).toBe(true);
    expect(options.hasWithoutMilestone).toBe(true);
  });

  it("does not offer a \"none\" filter when every row has a value", () => {
    const options = collectIssueFilterOptions([
      {
        kind: "ISSUE",
        openedAt: daysAgo(1),
        commentsCount: 0,
        repository: "example-org/a",
        title: "A",
        labels: [],
        assignees: ["alice"],
        milestone: "V1",
      },
    ]);

    expect(options.hasUnassigned).toBe(false);
    expect(options.hasWithoutMilestone).toBe(false);
  });
});

describe("summariseByRepository", () => {
  function stored(
    repository: string,
    overrides: Partial<IssueLike> & { id?: string } = {},
  ): IssueLike & { repository: string; id: string } {
    return { ...issue(overrides), repository };
  }

  it("returns nothing for an empty list", () => {
    expect(summariseByRepository([], { now: NOW })).toEqual([]);
  });

  it("counts issues, pull requests, new and unanswered entries per repository", () => {
    const summary = summariseByRepository(
      [
        stored("example-org/api", { id: "a1", openedAt: daysAgo(1) }),
        stored("example-org/api", { id: "a2", openedAt: daysAgo(10) }),
        stored("example-org/api", {
          id: "a3",
          kind: "PULL_REQUEST",
          openedAt: daysAgo(2),
        }),
        stored("example-org/site", { id: "s1", openedAt: daysAgo(200) }),
      ],
      { now: NOW },
    );

    expect(summary).toHaveLength(2);
    const api = summary.find((entry) => entry.repository === "example-org/api");
    expect(api).toMatchObject({
      openIssues: 2,
      pullRequests: 1,
      recent: 3,
      unanswered: 1, // a2 only: the pull request never counts as unanswered
      oldestAgeDays: 10,
    });

    const site = summary.find((entry) => entry.repository === "example-org/site");
    expect(site).toMatchObject({
      openIssues: 1,
      pullRequests: 0,
      recent: 0,
      unanswered: 1,
      oldestAgeDays: 200,
    });
  });

  it("puts the repositories that need attention first, then the busiest, then by name", () => {
    const summary = summariseByRepository(
      [
        // Quiet repository, nothing unanswered.
        stored("example-org/quiet", { id: "q1", openedAt: daysAgo(1) }),
        // Busy but answered.
        stored("example-org/busy", { id: "b1", openedAt: daysAgo(1), commentsCount: 3 }),
        stored("example-org/busy", { id: "b2", openedAt: daysAgo(2), commentsCount: 1 }),
        // One unanswered issue: first despite being the smallest.
        stored("example-org/ignored", { id: "i1", openedAt: daysAgo(6) }),
      ],
      { now: NOW },
    );

    expect(summary.map((entry) => entry.repository)).toEqual([
      "example-org/ignored",
      "example-org/busy",
      "example-org/quiet",
    ]);
  });

  it("ignores pull requests when reporting the oldest open issue", () => {
    const summary = summariseByRepository(
      [
        stored("example-org/api", { id: "p1", kind: "PULL_REQUEST", openedAt: daysAgo(300) }),
        stored("example-org/api", { id: "p2", openedAt: daysAgo(5) }),
      ],
      { now: NOW },
    );

    expect(summary[0].oldestAgeDays).toBe(5);
  });

  it("reports no age at all for a repository with only pull requests", () => {
    const summary = summariseByRepository(
      [stored("example-org/api", { id: "p1", kind: "PULL_REQUEST", openedAt: daysAgo(4) })],
      { now: NOW },
    );

    expect(summary[0]).toMatchObject({ openIssues: 0, pullRequests: 1, oldestAgeDays: null });
  });
});
