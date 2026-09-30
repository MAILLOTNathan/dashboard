/**
 * Milestones, as the dashboard reads them.
 *
 * A milestone is the only place where this integration shows a *plan*: a due date and
 * a progress. Both are worth stating precisely, because a number that looks like
 * progress but means something else is worse than no number:
 *
 * - the progress uses the provider's counters, which cover everything attached to the
 *   milestone — including items that are not followed here;
 * - the due date is a day, displayed in UTC like every other date of this project;
 *   GitHub stores a time on it, which carries no meaning.
 */

export type MilestoneLike = {
  title: string;
  /** "open" or "closed", as the provider reports it. */
  state: string;
  dueOn: Date | null;
  issuesOpen: number;
  issuesClosed: number;
};

export type MilestoneDueState =
  | { kind: "none" }
  | { kind: "overdue"; days: number }
  | { kind: "today" }
  | { kind: "upcoming"; days: number };

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function isMilestoneOpen(milestone: Pick<MilestoneLike, "state">): boolean {
  return milestone.state === "open";
}

/**
 * How the due date reads today.
 *
 * A closed milestone is never "late": its due date is history, and reporting it as
 * overdue would cry wolf about something that is done.
 */
export function describeMilestoneDue(
  milestone: MilestoneLike,
  now: Date = new Date(),
): MilestoneDueState {
  if (!milestone.dueOn || !isMilestoneOpen(milestone)) {
    return { kind: "none" };
  }

  const days = Math.ceil((milestone.dueOn.getTime() - now.getTime()) / MILLISECONDS_PER_DAY);

  if (days < 0) {
    return { kind: "overdue", days: -days };
  }

  if (days === 0) {
    return { kind: "today" };
  }

  return { kind: "upcoming", days };
}

/**
 * Share of the attached items that are done, between 0 and 1.
 *
 * Zero when nothing is attached: an empty milestone has no progress, which is not the
 * same as being finished, so the interface can print a dash instead of 100 %.
 */
export function milestoneProgress(milestone: MilestoneLike): number {
  const total = milestone.issuesOpen + milestone.issuesClosed;

  return total === 0 ? 0 : milestone.issuesClosed / total;
}

/**
 * Ordering: what is still to do comes first.
 *
 * Open milestones by soonest due date (undated last, since "no date" is not "due
 * first"), then the closed ones most recently due, which is the order a person looks
 * back at what shipped.
 */
export function sortMilestones<TMilestone extends MilestoneLike>(
  milestones: readonly TMilestone[],
): TMilestone[] {
  return [...milestones].sort((left, right) => {
    const leftOpen = isMilestoneOpen(left);
    const rightOpen = isMilestoneOpen(right);

    if (leftOpen !== rightOpen) {
      return leftOpen ? -1 : 1;
    }

    if (left.dueOn && right.dueOn) {
      return leftOpen
        ? left.dueOn.getTime() - right.dueOn.getTime()
        : right.dueOn.getTime() - left.dueOn.getTime();
    }

    if (left.dueOn) return -1;
    if (right.dueOn) return 1;

    return left.title.localeCompare(right.title);
  });
}
