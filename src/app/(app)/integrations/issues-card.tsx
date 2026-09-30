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
import { formatDateOnly, formatInstant } from "@/lib/dates";
import {
  ageInDays,
  computeIssueHighlights,
  isRecent,
  isUnanswered,
  sortIssuesByRecency,
} from "@/modules/integrations/issues";
import type { IssueSummary } from "@/modules/integrations/repository";

/**
 * Open issues and pull requests, fetched from the provider.
 *
 * What is shown is deliberately limited: title, identifier, link, author, comment
 * count, labels and dates. No description and no comment body — reading them happens
 * at the provider, where the permissions and the context are.
 *
 * The table is truncated, the indicators are not: they are computed on everything
 * that is followed, so "3 sans réponse" stays true even if only the newest rows fit.
 */
const DISPLAY_LIMIT = 25;

export function IssuesCard({
  issues,
  issueTrackingConnected,
  lastSyncedAt,
}: {
  issues: IssueSummary[];
  /** True when at least one connection fetches issues (GitHub today). */
  issueTrackingConnected: boolean;
  /** Last successful synchronisation of those connections, if any. */
  lastSyncedAt: Date | null;
}) {
  const now = new Date();
  const highlights = computeIssueHighlights(issues, { now });
  const ordered = sortIssuesByRecency(issues);
  const displayed = ordered.slice(0, DISPLAY_LIMIT);

  return (
    <Card
      title="Issues et pull requests ouvertes"
      description={
        issueTrackingConnected
          ? `Le texte reste chez le fournisseur : seuls le titre, le lien, l'auteur, les étiquettes et les dates sont repris ici.${
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

          <TableShell caption="Issues et pull requests ouvertes">
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Ouverte
                </th>
                <th scope="col" className={thClass}>
                  Sujet
                </th>
                <th scope="col" className={thClass}>
                  Auteur
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Commentaires
                </th>
                <th scope="col" className={thClass}>
                  Étiquettes
                </th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((issue) => {
                const ageDays = ageInDays(issue.openedAt, now);
                const unanswered = isUnanswered(issue, now, highlights.unansweredDays);

                return (
                  <tr key={issue.id}>
                    <td className={tdClass}>
                      <span className="whitespace-nowrap">
                        {formatDateOnly(issue.openedAt)}
                      </span>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        {describeAge(ageDays)}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {issue.kind === "PULL_REQUEST" ? (
                          <Badge tone="neutral">PR</Badge>
                        ) : null}
                        {isRecent(issue, now, highlights.recentDays) ? (
                          <Badge tone="positive">Nouvelle</Badge>
                        ) : null}
                        {unanswered ? <Badge tone="negative">Sans réponse</Badge> : null}
                      </span>
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
                        {issue.repository} #{issue.number} · {issue.connectionLabel}
                      </span>
                    </td>
                    <td className={tdClass}>
                      {issue.authorLogin ?? (
                        <span className="text-zinc-500 dark:text-zinc-400">Inconnu</span>
                      )}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {issue.commentsCount}
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
                  </tr>
                );
              })}
            </tbody>
          </TableShell>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {ordered.length > DISPLAY_LIMIT
              ? `${DISPLAY_LIMIT} plus récentes sur ${ordered.length} suivies. `
              : ""}
            Une synchronisation interroge les dépôts les plus récemment modifiés, par ordre
            d&apos;activité décroissante, et s&apos;arrête là : un dépôt ancien n&apos;est pas lu.
            Seules les issues encore ouvertes sont conservées.
          </p>
        </div>
      )}
    </Card>
  );
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
