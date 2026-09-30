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
