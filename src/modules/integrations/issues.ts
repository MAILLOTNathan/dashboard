import type { IssueKind } from "./domain";

/**
 * What deserves attention in a list of open issues.
 *
 * The purpose is not to display more numbers but to answer "what should I look at
 * today?". Every indicator below is therefore defined here, and nowhere else:
 * an undocumented indicator is not verifiable (see `docs/architecture/overview.md`).
 *
 * - `recent`       — opened within `recentDays` (14 by default). New work arriving.
 * - `unanswered`   — open for at least `unansweredDays` (3) with **zero** comments.
 *                    Someone reported something and nobody answered yet: the most
 *                    actionable signal, and the one nobody notices in a busy repo.
 * - `pullRequests` — open pull requests, counted apart: they are review work, not
 *                    reports, and a repository with only pull requests is healthy.
 * - `stale`        — open for at least `staleDays` (90). Reported, never judged: a
 *                    long-lived issue may well be a deliberate plan.
 * - `oldestOpen`   — the oldest open issue with its age, which is the honest answer
 *                    to "how far back does the backlog go?".
 *
 * An empty list yields zeros and a `null` oldest issue: the interface distinguishes
 * "nothing is open" from "not connected" and from "synchronisation failed" on its own.
 */
/**
 * The fields the rules below actually read.
 *
 * Structural on purpose: a freshly fetched provider issue and a row read back from
 * the database both satisfy it, so the same rules serve the synchronisation and the
 * page without either having to reshape its data.
 */
export type IssueLike = {
  kind: IssueKind;
  openedAt: Date;
  commentsCount: number;
};

/** What the explorer filters on: everything it displays, and nothing more. */
export type FilterableIssue = IssueLike & {
  repository: string;
  title: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
};

/** Sentinel used in a filter to mean "none of them", for an assignee or a milestone. */
export const FILTER_NONE = "none";

export const ISSUE_FLAGS = ["unanswered", "recent", "stale", "unassigned"] as const;
export type IssueFlag = (typeof ISSUE_FLAGS)[number];

export const ISSUE_SORTS = ["recent", "oldest", "comments", "activity"] as const;
export type IssueSort = (typeof ISSUE_SORTS)[number];

export type IssueFilters = {
  repository?: string;
  kind?: IssueKind;
  /** Login, or `FILTER_NONE` for issues nobody is assigned to. */
  assignee?: string;
  label?: string;
  /** Milestone title, or `FILTER_NONE` for issues without one. */
  milestone?: string;
  flags?: readonly IssueFlag[];
  /** Case-insensitive substring of the title. */
  query?: string;
  sort?: IssueSort;
};

/**
 * The values present in the current selection, used to build the filter controls.
 *
 * Built from the data rather than hard-coded: a filter offering a value that matches
 * nothing would be a dead end, and one missing a value would hide rows silently.
 */
export function collectIssueFilterOptions(issues: readonly FilterableIssue[]): {
  repositories: string[];
  assignees: string[];
  labels: string[];
  milestones: string[];
  hasUnassigned: boolean;
  hasWithoutMilestone: boolean;
} {
  const repositories = new Set<string>();
  const assignees = new Set<string>();
  const labels = new Set<string>();
  const milestones = new Set<string>();
  let hasUnassigned = false;
  let hasWithoutMilestone = false;

  for (const issue of issues) {
    repositories.add(issue.repository);

    if (issue.assignees.length === 0) {
      hasUnassigned = true;
    } else {
      for (const assignee of issue.assignees) {
        assignees.add(assignee);
      }
    }

    for (const label of issue.labels) {
      labels.add(label);
    }

    if (issue.milestone === null) {
      hasWithoutMilestone = true;
    } else {
      milestones.add(issue.milestone);
    }
  }

  return {
    repositories: [...repositories].sort(),
    assignees: [...assignees].sort(),
    labels: [...labels].sort(),
    milestones: [...milestones].sort(),
    hasUnassigned,
    hasWithoutMilestone,
  };
}

/**
 * Applies the explorer filters.
 *
 * Every filter is inclusive and independent: the result is the intersection, so adding
 * a criterion can only narrow the list. An empty filter value (undefined, or an empty
 * string coming from a form) means "no constraint", never "match nothing".
 *
 * The flags reuse the predicates of the summary above, so "sans réponse" means the
 * same thing in a badge and in a filter.
 */
export function filterIssues<TIssue extends FilterableIssue>(
  issues: readonly TIssue[],
  filters: IssueFilters,
  options: { now?: Date; recentDays?: number; unansweredDays?: number; staleDays?: number } = {},
): TIssue[] {
  const now = options.now ?? new Date();
  const recentDays = options.recentDays ?? DEFAULT_RECENT_DAYS;
  const unansweredDays = options.unansweredDays ?? DEFAULT_UNANSWERED_DAYS;
  const staleDays = options.staleDays ?? DEFAULT_STALE_DAYS;
  const flags = filters.flags ?? [];
  const query = filters.query?.trim().toLowerCase() ?? "";

  const filtered = issues.filter((issue) => {
    if (filters.repository && issue.repository !== filters.repository) {
      return false;
    }

    if (filters.kind && issue.kind !== filters.kind) {
      return false;
    }

    if (filters.assignee === FILTER_NONE) {
      if (issue.assignees.length > 0) {
        return false;
      }
    } else if (filters.assignee && !issue.assignees.includes(filters.assignee)) {
      return false;
    }

    if (filters.label && !issue.labels.includes(filters.label)) {
      return false;
    }

    if (filters.milestone === FILTER_NONE) {
      if (issue.milestone !== null) {
        return false;
      }
    } else if (filters.milestone && issue.milestone !== filters.milestone) {
      return false;
    }

    if (query && !issue.title.toLowerCase().includes(query)) {
      return false;
    }

    for (const flag of flags) {
      if (flag === "unanswered" && !isUnanswered(issue, now, unansweredDays)) {
        return false;
      }
      if (flag === "recent" && !isRecent(issue, now, recentDays)) {
        return false;
      }
      if (flag === "stale" && !isStale(issue, now, staleDays)) {
        return false;
      }
      if (flag === "unassigned" && issue.assignees.length > 0) {
        return false;
      }
    }

    return true;
  });

  return sortIssues(filtered, filters.sort ?? "recent");
}

/** Sorts an already filtered list. `recent` is the default: newest arrived first. */
export function sortIssues<TIssue extends IssueLike>(
  issues: readonly TIssue[],
  sort: IssueSort,
): TIssue[] {
  const sorted = [...issues];

  switch (sort) {
    case "oldest":
      return sorted.sort((left, right) => left.openedAt.getTime() - right.openedAt.getTime());
    case "comments":
      return sorted.sort((left, right) => right.commentsCount - left.commentsCount);
    case "activity":
      // Needs `activityAt`, which `IssueLike` does not carry: the caller that asks for
      // this sort passes rows that have it.
      return sorted.sort(
        (left, right) =>
          activityTime(right) - activityTime(left),
      );
    case "recent":
    default:
      return sorted.sort((left, right) => right.openedAt.getTime() - left.openedAt.getTime());
  }
}

function activityTime(issue: IssueLike): number {
  const value = (issue as { activityAt?: unknown }).activityAt;
  return value instanceof Date ? value.getTime() : 0;
}

export type IssueHighlights<TIssue extends IssueLike = IssueLike> = {
  total: number;
  recent: number;
  unanswered: number;
  pullRequests: number;
  stale: number;
  oldestOpen: { issue: TIssue; ageDays: number } | null;
  recentDays: number;
  unansweredDays: number;
  staleDays: number;
};

export const DEFAULT_RECENT_DAYS = 14;
export const DEFAULT_UNANSWERED_DAYS = 3;
export const DEFAULT_STALE_DAYS = 90;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days between two instants, floored: "3 jours" means at least 72 hours. */
export function ageInDays(from: Date, now: Date): number {
  return Math.floor((now.getTime() - from.getTime()) / MILLISECONDS_PER_DAY);
}

/** True when the issue is an issue: a pull request is never "unanswered". */
export function isQuestion(issue: Pick<IssueLike, "kind">): boolean {
  return issue.kind === "ISSUE";
}

export function isRecent(issue: IssueLike, now: Date, recentDays: number): boolean {
  return ageInDays(issue.openedAt, now) < recentDays;
}

/**
 * Nobody has answered: no comment at all, and enough time has passed that a reply
 * would normally have arrived.
 */
export function isUnanswered(
  issue: IssueLike,
  now: Date,
  unansweredDays: number,
): boolean {
  return (
    isQuestion(issue) &&
    issue.commentsCount === 0 &&
    ageInDays(issue.openedAt, now) >= unansweredDays
  );
}

export function isStale(issue: IssueLike, now: Date, staleDays: number): boolean {
  return isQuestion(issue) && ageInDays(issue.openedAt, now) >= staleDays;
}

export function computeIssueHighlights<TIssue extends IssueLike>(
  issues: readonly TIssue[],
  options: { now?: Date; recentDays?: number; unansweredDays?: number; staleDays?: number } = {},
): IssueHighlights<TIssue> {
  const now = options.now ?? new Date();
  const recentDays = options.recentDays ?? DEFAULT_RECENT_DAYS;
  const unansweredDays = options.unansweredDays ?? DEFAULT_UNANSWERED_DAYS;
  const staleDays = options.staleDays ?? DEFAULT_STALE_DAYS;

  let recent = 0;
  let unanswered = 0;
  let pullRequests = 0;
  let stale = 0;
  let oldest: TIssue | null = null;

  for (const issue of issues) {
    if (isRecent(issue, now, recentDays)) {
      recent += 1;
    }
    if (isUnanswered(issue, now, unansweredDays)) {
      unanswered += 1;
    }
    if (issue.kind === "PULL_REQUEST") {
      pullRequests += 1;
    }
    if (isStale(issue, now, staleDays)) {
      stale += 1;
    }
    if (isQuestion(issue) && (!oldest || issue.openedAt.getTime() < oldest.openedAt.getTime())) {
      oldest = issue;
    }
  }

  return {
    total: issues.length,
    recent,
    unanswered,
    pullRequests,
    stale,
    oldestOpen: oldest ? { issue: oldest, ageDays: ageInDays(oldest.openedAt, now) } : null,
    recentDays,
    unansweredDays,
    staleDays,
  };
}

/**
 * Orders issues for the interface: newest first, which is the order a person scans.
 *
 * Pull requests are not pushed to the bottom on purpose: an open pull request is
 * actionable too, and mixing them keeps one chronological list to read.
 */
export function sortIssuesByRecency<TIssue extends IssueLike>(
  issues: readonly TIssue[],
): TIssue[] {
  return [...issues].sort((left, right) => right.openedAt.getTime() - left.openedAt.getTime());
}

/** One line per repository: the view that never truncates. */
export type RepositoryIssueSummary = {
  repository: string;
  openIssues: number;
  pullRequests: number;
  recent: number;
  unanswered: number;
  /** Age of the oldest **issue** still open in this repository, in whole days. */
  oldestAgeDays: number | null;
};

/**
 * Counts per repository.
 *
 * The flat list is truncated to stay readable, which can hide a whole repository;
 * this summary cannot, so "the issues of each repository" is always answerable.
 *
 * Sorted by attention rather than alphabetically: repositories with unanswered
 * issues first, then the ones with the most open issues, then by name so the order
 * never moves for two repositories of equal weight.
 */
export function summariseByRepository<TIssue extends IssueLike & { repository: string }>(
  issues: readonly TIssue[],
  options: { now?: Date; recentDays?: number; unansweredDays?: number } = {},
): RepositoryIssueSummary[] {
  const now = options.now ?? new Date();
  const recentDays = options.recentDays ?? DEFAULT_RECENT_DAYS;
  const unansweredDays = options.unansweredDays ?? DEFAULT_UNANSWERED_DAYS;

  const byRepository = new Map<string, RepositoryIssueSummary & { oldestOpenedAt: number | null }>();

  for (const issue of issues) {
    const summary = byRepository.get(issue.repository) ?? {
      repository: issue.repository,
      openIssues: 0,
      pullRequests: 0,
      recent: 0,
      unanswered: 0,
      oldestAgeDays: null,
      oldestOpenedAt: null,
    };

    if (isQuestion(issue)) {
      summary.openIssues += 1;

      if (summary.oldestOpenedAt === null || issue.openedAt.getTime() < summary.oldestOpenedAt) {
        summary.oldestOpenedAt = issue.openedAt.getTime();
      }
    } else {
      summary.pullRequests += 1;
    }

    if (isRecent(issue, now, recentDays)) {
      summary.recent += 1;
    }

    if (isUnanswered(issue, now, unansweredDays)) {
      summary.unanswered += 1;
    }

    byRepository.set(issue.repository, summary);
  }

  return [...byRepository.values()]
    .map(({ oldestOpenedAt, ...summary }) => ({
      ...summary,
      oldestAgeDays:
        oldestOpenedAt === null
          ? null
          : ageInDays(new Date(oldestOpenedAt), now),
    }))
    .sort(
      (left, right) =>
        right.unanswered - left.unanswered ||
        right.openIssues - left.openIssues ||
        left.repository.localeCompare(right.repository),
    );
}
