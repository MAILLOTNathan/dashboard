import Link from "next/link";
import { Badge, Card, Notice, TableShell, tdClass, thClass } from "@/components/ui";
import { formatDateOnly } from "@/lib/dates";
import {
  describeMilestoneDue,
  isMilestoneOpen,
  milestoneProgress,
  sortMilestones,
} from "@/modules/integrations/milestones";
import type { MilestoneSummary } from "@/modules/integrations/repository";

/**
 * Milestones, with their due date and progress.
 *
 * Two figures sit side by side on purpose, and the columns say which is which: the
 * provider's counters cover **everything** attached to the milestone, while "suivi ici"
 * counts what this dashboard actually stores. Printing only ours would look like the
 * milestone is nearly empty; printing only theirs would not match the list below.
 */
export function MilestonesCard({
  milestones,
  lastSyncedAt,
}: {
  milestones: MilestoneSummary[];
  lastSyncedAt: Date | null;
}) {
  const now = new Date();
  const ordered = sortMilestones(milestones);
  const overdue = ordered.filter((milestone) => describeMilestoneDue(milestone, now).kind === "overdue");

  return (
    <Card
      title="Jalons"
      description={
        lastSyncedAt
          ? `Échéances et avancement, lus chez le fournisseur. Dernière lecture : ${new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", dateStyle: "short" }).format(lastSyncedAt)}.`
          : undefined
      }
    >
      {milestones.length === 0 ? (
        <Notice tone="info">
          Aucun jalon suivi. Soit les dépôts interrogés n&apos;en ont pas, soit la
          synchronisation n&apos;a pas encore eu lieu.
        </Notice>
      ) : (
        <div className="flex flex-col gap-3">
          {overdue.length > 0 ? (
            <Notice tone="warning">
              {overdue.length} jalon(s) ouvert(s) dont l&apos;échéance est dépassée.
            </Notice>
          ) : null}

          <TableShell caption="Jalons suivis">
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Jalon
                </th>
                <th scope="col" className={thClass}>
                  État
                </th>
                <th scope="col" className={thClass}>
                  Échéance
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Avancement
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Suivi ici
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Sans assigné
                </th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((milestone) => {
                const due = describeMilestoneDue(milestone, now);
                const progress = milestoneProgress(milestone);
                const total = milestone.issuesOpen + milestone.issuesClosed;

                return (
                  <tr key={milestone.id}>
                    <td className={tdClass}>
                      <Link
                        href={milestone.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {milestone.title}
                      </Link>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        {milestone.repository} · jalon #{milestone.number}
                      </span>
                    </td>
                    <td className={tdClass}>
                      <Badge tone={isMilestoneOpen(milestone) ? "neutral" : "positive"}>
                        {isMilestoneOpen(milestone) ? "Ouvert" : "Fermé"}
                      </Badge>
                    </td>
                    <td className={tdClass}>
                      {milestone.dueOn ? (
                        <>
                          {formatDateOnly(milestone.dueOn)}
                          <span
                            className={`block text-xs ${
                              due.kind === "overdue"
                                ? "font-medium text-rose-700 dark:text-rose-400"
                                : "text-zinc-500 dark:text-zinc-400"
                            }`}
                          >
                            {describeDue(due)}
                          </span>
                        </>
                      ) : (
                        <span className="text-zinc-500 dark:text-zinc-400">Aucune</span>
                      )}
                    </td>
                    <td className={`${tdClass} text-right`}>
                      {total === 0 ? (
                        <span className="text-zinc-500 dark:text-zinc-400">—</span>
                      ) : (
                        <>
                          <span className="tabular-nums">{Math.round(progress * 100)} %</span>
                          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                            {milestone.issuesClosed} fermée(s) / {total}
                          </span>
                        </>
                      )}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {milestone.trackedIssues}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {milestone.unassigned > 0 ? (
                        <span className="font-semibold text-rose-700 dark:text-rose-400">
                          {milestone.unassigned}
                        </span>
                      ) : (
                        0
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            « Avancement » utilise les compteurs du fournisseur : ils couvrent tout ce qui
            est rattaché au jalon, y compris ce qui n&apos;est pas suivi ici. « Suivi ici »
            ne compte que les issues enregistrées dans ce tableau de bord, et « sans
            assigné » parmi celles-ci.
          </p>
        </div>
      )}
    </Card>
  );
}

function describeDue(due: ReturnType<typeof describeMilestoneDue>): string {
  switch (due.kind) {
    case "overdue":
      return `en retard de ${due.days} j`;
    case "today":
      return "aujourd'hui";
    case "upcoming":
      return `dans ${due.days} j`;
    case "none":
      return "";
  }
}
