import Link from "next/link";
import {
  Badge,
  Card,
  EmptyState,
  Notice,
  StatCard,
  TableShell,
  tdClass,
  thClass,
} from "@/components/ui";
import { formatInstant } from "@/lib/dates";
import {
  computeIssueHighlights,
  summariseByRepository,
} from "@/modules/integrations/issues";
import type { IssueSummary } from "@/modules/integrations/repository";

/**
 * Open issues and pull requests, per repository.
 *
 * This card is the map: which repositories have work, how much, and what is being
 * forgotten. The list itself lives in the explorer below, where it can be filtered.
 *
 * What is shown is deliberately limited: titles, links, assignees, milestones, labels
 * and dates. No description and no comment body — reading those happens at the
 * provider, where the permissions and the context are.
 *
 * The per-repository table is never truncated: a repository must not disappear below
 * the fold of a long list.
 */

export function IssuesCard({
  issues,
  issueTrackingConnected,
  lastSyncedAt,
  selectedRepository,
}: {
  issues: IssueSummary[];
  /** True when at least one connection fetches issues (GitHub today). */
  issueTrackingConnected: boolean;
  /** Last successful synchronisation of those connections, if any. */
  lastSyncedAt: Date | null;
  /** Repository focused through `?repo=`, when it is still one of the followed ones. */
  selectedRepository?: string;
}) {
  const now = new Date();
  const repositories = summariseByRepository(issues, { now });
  const focused = repositories.find((entry) => entry.repository === selectedRepository);

  // Focusing on one repository recomputes every indicator on that repository alone, so
  // the figures always describe the rows displayed next to them.
  const highlights = computeIssueHighlights(
    focused
      ? issues.filter((issue) => issue.repository === focused.repository)
      : issues,
    { now },
  );

  return (
    <Card
      title="Issues et pull requests ouvertes"
      description={
        issueTrackingConnected
          ? `Le texte reste chez le fournisseur : seuls le titre, le lien, l'auteur, les assignés, le jalon, les étiquettes et les dates sont repris ici.${
              lastSyncedAt ? ` Dernière lecture : ${formatInstant(lastSyncedAt)}.` : ""
            }`
          : undefined
      }
    >
      {!issueTrackingConnected ? (
        <EmptyState
          title="Aucune connexion ne remonte d'issues"
          description="GitHub remonte les issues ouvertes. GitLab n'est pas interrogé sur ce point : l'intégration s'en tient aux métadonnées de projet, pour ne pas lire au-delà de ce qui est autorisé. Un état vide ici ne signifie pas « rien n'est ouvert »."
        />
      ) : issues.length === 0 ? (
        <Notice tone="info">
          {lastSyncedAt
            ? "Aucune issue ouverte n'est suivie. La synchronisation a bien eu lieu : c'est un résultat, pas un manque de données."
            : "Aucune synchronisation n'a encore eu lieu : rien n'a été lu, donc rien ne peut être affiché."}
        </Notice>
      ) : (
        <div className="flex flex-col gap-4">
          <TableShell caption="Issues ouvertes par dépôt">
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Dépôt
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Issues
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  PR
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Nouvelles
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Sans réponse
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Plus ancienne
                </th>
                <th scope="col" className={thClass}>
                  Vue
                </th>
              </tr>
            </thead>
            <tbody>
              {repositories.map((entry) => {
                const isFocused = entry.repository === focused?.repository;

                return (
                  <tr
                    key={entry.repository}
                    className={isFocused ? "bg-zinc-50 dark:bg-zinc-800/60" : undefined}
                  >
                    <td className={tdClass}>
                      <span className="font-medium">{entry.repository}</span>
                      {isFocused ? (
                        <span className="ml-2 inline-flex">
                          <Badge tone="neutral">Sélectionné</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {entry.openIssues}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {entry.pullRequests}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>{entry.recent}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {entry.unanswered > 0 ? (
                        <span className="font-semibold text-rose-700 dark:text-rose-400">
                          {entry.unanswered}
                        </span>
                      ) : (
                        0
                      )}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {entry.oldestAgeDays === null ? "—" : `${entry.oldestAgeDays} j`}
                    </td>
                    <td className={tdClass}>
                      {isFocused ? (
                        <Link href="/integrations" className="underline-offset-2 hover:underline">
                          Tous les dépôts
                        </Link>
                      ) : (
                        <Link
                          href={`/integrations?repo=${encodeURIComponent(entry.repository)}`}
                          className="underline-offset-2 hover:underline"
                        >
                          Voir ses issues
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>

          <p className="text-sm font-medium">
            {focused ? (
              <>
                {focused.repository} — {focused.openIssues} issue(s) et{" "}
                {focused.pullRequests} pull request(s) ouverte(s)
              </>
            ) : (
              <>Toutes les issues suivies ({issues.length})</>
            )}
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={`Ouvertes depuis moins de ${highlights.recentDays} j`}
              value={String(highlights.recent)}
              hint="Ce qui vient d'arriver et mérite une première lecture."
            />
            <StatCard
              label={`Sans réponse (≥ ${highlights.unansweredDays} j)`}
              value={String(highlights.unanswered)}
              tone={highlights.unanswered > 0 ? "negative" : "neutral"}
              hint="Ouvertes, aucun commentaire : personne ne s'en est occupé."
            />
            <StatCard
              label="Pull requests ouvertes"
              value={String(highlights.pullRequests)}
              hint="Revue en attente, comptée à part des signalements."
            />
            <StatCard
              label="Plus ancienne encore ouverte"
              value={
                highlights.oldestOpen
                  ? `${highlights.oldestOpen.ageDays} j`
                  : "Aucune"
              }
              hint={
                highlights.oldestOpen
                  ? `#${highlights.oldestOpen.issue.number} — ${highlights.oldestOpen.issue.repository}`
                  : "Aucune issue ouverte suivie."
              }
            />
          </div>

          {highlights.stale > 0 ? (
            <Notice tone="warning">
              {highlights.stale} issue(s) ouverte(s) depuis plus de {highlights.staleDays} jours.
              Un ancien ticket peut être un plan assumé : à vous de décider s&apos;il faut le
              fermer, le replanifier ou le laisser.
            </Notice>
          ) : null}

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {focused
              ? `Les issues de ${focused.repository} sont listées dans l'explorateur ci-dessous. `
              : "Choisissez un dépôt pour restreindre l'explorateur ci-dessous. "}
            Une synchronisation interroge les dépôts les plus récemment modifiés, par ordre
            d&apos;activité décroissante, et s&apos;arrête là : un dépôt ancien n&apos;est pas lu.
            Seules les issues encore ouvertes sont conservées. Un dépôt absent de ce tableau
            n&apos;a soit aucune issue ouverte, soit n&apos;a pas été interrogé.
          </p>
        </div>
      )}
    </Card>
  );
}
