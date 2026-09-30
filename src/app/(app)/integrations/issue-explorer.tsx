import Link from "next/link";
import {
  Badge,
  Card,
  EmptyState,
  TableShell,
  tdClass,
  thClass,
} from "@/components/ui";
import { formatDateOnly } from "@/lib/dates";
import {
  ageInDays,
  FILTER_NONE,
  isRecent,
  isUnanswered,
  type IssueFilters,
  type IssueSort,
} from "@/modules/integrations/issues";
import type { IssueSummary } from "@/modules/integrations/repository";

/**
 * The issue and pull request explorer.
 *
 * The whole point is to be narrowable: one repository, one assignee, one milestone, the
 * items nobody picked up. The filters are URL parameters, so a view is shareable,
 * bookmarkable, and survives a reload — and nothing needs client-side state.
 *
 * Only titles, links and metadata are shown: descriptions and comments stay at GitHub,
 * which is where the permissions and the context are.
 */
const DISPLAY_LIMIT = 100;

export function IssueExplorer({
  issues,
  totalCount,
  filters,
  options,
}: {
  /** Already filtered and sorted by the page. */
  issues: IssueSummary[];
  /** Everything followed, so the count can say how much was filtered out. */
  totalCount: number;
  filters: IssueFilters;
  options: {
    repositories: string[];
    assignees: string[];
    labels: string[];
    milestones: string[];
    hasUnassigned: boolean;
    hasWithoutMilestone: boolean;
  };
}) {
  const now = new Date();
  const displayed = issues.slice(0, DISPLAY_LIMIT);
  const activeCount = countActiveFilters(filters);

  return (
    <Card
      title="Explorer les issues et pull requests"
      description="Filtres combinables : dépôt, type, assigné, étiquette, jalon, état. Le texte des issues reste chez GitHub, seuls les titres et les métadonnées sont repris ici."
    >
      <div className="flex flex-col gap-4">
        <form method="get" action="/integrations" className="flex flex-wrap items-end gap-3">
          <Select label="Dépôt" name="repo" value={filters.repository} allLabel="Tous" values={options.repositories} />

          <Select
            label="Type"
            name="kind"
            value={filters.kind}
            allLabel="Tous"
            values={["ISSUE", "PULL_REQUEST"]}
            labels={{ ISSUE: "Issues", PULL_REQUEST: "Pull requests" }}
          />

          <Select
            label="Assigné à"
            name="assignee"
            value={filters.assignee}
            allLabel="Tous"
            values={options.assignees}
            extra={options.hasUnassigned ? [{ value: FILTER_NONE, label: "Personne" }] : []}
          />

          <Select
            label="Étiquette"
            name="label"
            value={filters.label}
            allLabel="Toutes"
            values={options.labels}
          />

          <Select
            label="Jalon"
            name="milestone"
            value={filters.milestone}
            allLabel="Tous"
            values={options.milestones}
            extra={options.hasWithoutMilestone ? [{ value: FILTER_NONE, label: "Aucun" }] : []}
          />

          <Select
            label="État"
            name="flag"
            value={filters.flags?.[0]}
            allLabel="Tous"
            values={["unanswered", "recent", "stale", "unassigned"]}
            labels={{
              unanswered: `Sans réponse (≥ 3 j)`,
              recent: "Ouvertes récemment (14 j)",
              stale: "Anciennes (≥ 90 j)",
              unassigned: "Sans assigné",
            }}
          />

          <Select
            label="Tri"
            name="sort"
            value={filters.sort}
            allLabel="Plus récentes"
            values={["oldest", "comments", "activity"]}
            labels={{
              oldest: "Plus anciennes",
              comments: "Plus commentées",
              activity: "Activité récente",
            }}
          />

          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Titre contient</span>
            <input
              type="search"
              name="q"
              defaultValue={filters.query ?? ""}
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Filtrer
            </button>
            <Link
              href="/integrations"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Réinitialiser
            </Link>
          </div>
        </form>

        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {issues.length === 0
            ? `Aucun résultat sur ${totalCount} issue(s) suivie(s).`
            : `${issues.length} résultat(s) sur ${totalCount} suivie(s)`}
          {activeCount > 0 ? ` · ${activeCount} filtre(s) actif(s)` : ""}
          {issues.length > DISPLAY_LIMIT
            ? ` · ${DISPLAY_LIMIT} premières affichées : affinez les filtres pour voir les autres.`
            : ""}
        </p>

        {displayed.length === 0 ? (
          <EmptyState
            title="Aucune issue ne correspond"
            description="Les filtres sont exhaustifs : élargissez-en un, ou réinitialisez pour revenir à la liste complète."
          />
        ) : (
          <TableShell caption="Issues et pull requests filtrées">
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Type
                </th>
                <th scope="col" className={thClass}>
                  Sujet
                </th>
                <th scope="col" className={thClass}>
                  Assigné à
                </th>
                <th scope="col" className={thClass}>
                  Jalon
                </th>
                <th scope="col" className={thClass}>
                  Étiquettes
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Comm.
                </th>
                <th scope="col" className={thClass}>
                  Ouverte
                </th>
                <th scope="col" className={thClass}>
                  Activité
                </th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((issue) => (
                <tr key={issue.id}>
                  <td className={tdClass}>
                    <Badge tone={issue.kind === "PULL_REQUEST" ? "neutral" : "positive"}>
                      {issue.kind === "PULL_REQUEST" ? "PR" : "Issue"}
                    </Badge>
                  </td>
                  <td className={tdClass}>
                    <Link
                      href={issue.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {issue.title}
                    </Link>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {issue.repository} #{issue.number} · ouvert par{" "}
                      {issue.authorLogin ?? "inconnu"}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {isRecent(issue, now, 14) ? <Badge tone="positive">Nouvelle</Badge> : null}
                      {isUnanswered(issue, now, 3) ? (
                        <Badge tone="negative">Sans réponse</Badge>
                      ) : null}
                    </span>
                  </td>
                  <td className={tdClass}>
                    {issue.assignees.length === 0 ? (
                      <span className="text-zinc-500 dark:text-zinc-400">Personne</span>
                    ) : (
                      issue.assignees.join(", ")
                    )}
                  </td>
                  <td className={tdClass}>
                    {issue.milestone ?? (
                      <span className="text-zinc-500 dark:text-zinc-400">Aucun</span>
                    )}
                  </td>
                  <td className={tdClass}>
                    {issue.labels.length === 0 ? (
                      <span className="text-zinc-500 dark:text-zinc-400">Aucune</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {issue.labels.map((label) => (
                          <Badge key={label} tone="neutral">
                            {label}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className={`${tdClass} text-right tabular-nums`}>
                    {issue.commentsCount}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {formatDateOnly(issue.openedAt)}
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {describeAge(ageInDays(issue.openedAt, now))}
                    </span>
                  </td>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {formatDateOnly(issue.activityAt)}
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {describeAge(ageInDays(issue.activityAt, now))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </div>
    </Card>
  );
}

/** The number of criteria currently narrowing the list, shown next to the count. */
function countActiveFilters(filters: IssueFilters): number {
  return [
    filters.repository,
    filters.kind,
    filters.assignee,
    filters.label,
    filters.milestone,
    filters.query,
    filters.sort && filters.sort !== ("recent" satisfies IssueSort) ? filters.sort : undefined,
    ...(filters.flags ?? []),
  ].filter((value) => value !== undefined && value !== "").length;
}

/** Age in plain words, floored: "il y a 3 j" never means 2 days and 20 hours. */
function describeAge(days: number): string {
  if (days <= 0) {
    return "aujourd'hui";
  }

  if (days === 1) {
    return "hier";
  }

  return `il y a ${days} j`;
}

/**
 * A filter control: a `<select>` plus a submit, no client-side state.
 *
 * The empty option means "no constraint" and is always first, so clearing a filter is
 * one gesture from anywhere.
 */
function Select({
  label,
  name,
  value,
  allLabel,
  values,
  labels = {},
  extra = [],
}: {
  label: string;
  name: string;
  value: string | undefined;
  allLabel: string;
  values: string[];
  labels?: Record<string, string>;
  extra?: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ""}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
      >
        <option value="">{allLabel}</option>
        {values.map((option) => (
          <option key={option} value={option}>
            {labels[option] ?? option}
          </option>
        ))}
        {extra.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
