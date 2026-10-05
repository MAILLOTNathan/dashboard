import {
  Badge,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  TableShell,
  tdClass,
  thClass,
} from "@/components/ui";
import { requireUser } from "@/lib/auth/guard";
import { formatInstant } from "@/lib/dates";
import { readSearchParam } from "@/lib/search-params";
import {
  describeInstance,
  describeSyncRun,
  formatRunDuration,
  INTEGRATION_PROVIDERS,
  isSyncStale,
  ISSUE_KINDS,
  type IntegrationProvider,
  type SyncRunSummary,
} from "@/modules/integrations/domain";
import {
  collectIssueFilterOptions,
  FILTER_NONE,
  filterIssues,
  ISSUE_FLAGS,
  ISSUE_SORTS,
  type IssueFilters,
} from "@/modules/integrations/issues";
import {
  listConnections,
  listIssues,
  listMilestones,
  listSyncRuns,
} from "@/modules/integrations/repository";
import { connectProviderAction, syncConnectionAction } from "./actions";
import { IssueExplorer } from "./issue-explorer";
import { IssuesCard } from "./issues-card";
import { MilestonesCard } from "./milestones-card";

export const dynamic = "force-dynamic";

const STATUS_MESSAGES: Record<string, { tone: "info" | "warning" | "error"; text: string }> = {
  connected: {
    tone: "info",
    text: "Connexion enregistrée. Lancez une synchronisation pour récupérer les projets autorisés.",
  },
  invalid: {
    tone: "error",
    text: "Connexion refusée : vérifiez le fournisseur, l'URL d'instance et le jeton.",
  },
};

/** Read-only scopes, displayed so the requested permissions stay explicit. */
const SCOPES: Record<IntegrationProvider, string> = {
  GITHUB: "repo:read, public_repo:read",
  GITLAB: "read_api",
};

/** Providers whose open issues are fetched. See the GitLab adapter for the reasons. */
const ISSUE_TRACKING_PROVIDERS: readonly IntegrationProvider[] = ["GITHUB"];

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const [connections, issues, milestones, runs] = await Promise.all([
    listConnections(user.id),
    listIssues(user.id),
    listMilestones(user.id),
    listSyncRuns(user.id),
  ]);

  // One clock for the whole page: a connection stale at render is stale everywhere.
  const now = new Date();
  const isStaleAt = (date: Date) => isSyncStale(date, now);

  // The newest run per connection is what "the last synchronisation" means; the
  // full list below it is the history.
  const latestRuns = new Map<string, SyncRunSummary>();
  for (const run of runs) {
    if (!latestRuns.has(run.connectionId)) {
      latestRuns.set(run.connectionId, run);
    }
  }

  const issueConnections = connections.filter((connection) =>
    ISSUE_TRACKING_PROVIDERS.includes(connection.provider),
  );
  const lastIssueSync = issueConnections.reduce<Date | null>((latest, connection) => {
    if (!connection.lastSyncedAt) {
      return latest;
    }

    return !latest || connection.lastSyncedAt > latest ? connection.lastSyncedAt : latest;
  }, null);

  const status = typeof params.status === "string" ? params.status : undefined;
  const sync = typeof params.sync === "string" ? params.sync : undefined;
  const reason = typeof params.reason === "string" ? params.reason : undefined;
  const code = typeof params.code === "string" ? params.code : undefined;
  // Repository focused in the issues card (`?repo=owner/name`). An unknown value
  // simply shows every repository: no need to fail on a stale bookmark.
  const selectedRepository = readSearchParam(params, "repo");

  // Explorer filters. Every value is validated against what actually exists in the data
  // before it is applied. A stale bookmark naming a deleted repository would otherwise
  // filter everything out while its select shows "Tous" — a screen that lies, which is
  // worse than a filter that is simply ignored.
  const filterOptions = collectIssueFilterOptions(issues);
  const requestedAssignee = readSearchParam(params, "assignee");
  const requestedMilestone = readSearchParam(params, "milestone");
  const requestedLabel = readSearchParam(params, "label");

  const filters: IssueFilters = {
    repository: filterOptions.repositories.includes(selectedRepository ?? "")
      ? selectedRepository
      : undefined,
    kind: ISSUE_KINDS.find((kind) => kind === readSearchParam(params, "kind")),
    assignee:
      requestedAssignee === FILTER_NONE
        ? filterOptions.hasUnassigned
          ? FILTER_NONE
          : undefined
        : filterOptions.assignees.includes(requestedAssignee ?? "")
          ? requestedAssignee
          : undefined,
    label: filterOptions.labels.includes(requestedLabel ?? "") ? requestedLabel : undefined,
    milestone:
      requestedMilestone === FILTER_NONE
        ? filterOptions.hasWithoutMilestone
          ? FILTER_NONE
          : undefined
        : filterOptions.milestones.includes(requestedMilestone ?? "")
          ? requestedMilestone
          : undefined,
    flags: ISSUE_FLAGS.filter((flag) => flag === readSearchParam(params, "flag")),
    query: readSearchParam(params, "q"),
    sort: ISSUE_SORTS.find((sort) => sort === readSearchParam(params, "sort")),
  };

  const filteredIssues = filterIssues(issues, filters);

  return (
    <>
      <PageHeader
        title="Intégrations"
        description="GitHub et GitLab, en lecture seule. Les jetons restent côté serveur, chiffrés au repos."
      />

      {status && STATUS_MESSAGES[status] ? (
        <Notice tone={STATUS_MESSAGES[status].tone}>{STATUS_MESSAGES[status].text}</Notice>
      ) : null}

      {sync === "ok" ? (
        <Notice tone="info">
          Synchronisation terminée. Le détail de ce passage est conservé dans
          l&apos;historique ci-dessous, y compris après un rafraîchissement.
        </Notice>
      ) : null}

      {sync === "error" ? (
        <Notice tone="error">
          Synchronisation en échec ({code ?? "erreur inconnue"}). La dernière synchronisation
          réussie reste affichée : elle n&apos;est pas remplacée par un zéro.
        </Notice>
      ) : null}

      {sync === "skipped" ? (
        <Notice tone="warning">
          Synchronisation ignorée ({reason ?? "raison inconnue"}). Un jeton absent ou
          illisible doit être remplacé avant de réessayer.
        </Notice>
      ) : null}

      <Card
        title="Connexions"
        description="Un jeton n'est jamais renvoyé au navigateur : seul son état est affiché."
      >
        {connections.length === 0 ? (
          <EmptyState
            title="Non connecté"
            description="Aucun fournisseur n'est configuré. Un état vide ne signifie pas « aucun projet » : rien n'a encore été interrogé."
          />
        ) : (
          <TableShell caption="Connexions aux fournisseurs">
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Fournisseur
                </th>
                <th scope="col" className={thClass}>
                  Instance / périmètre
                </th>
                <th scope="col" className={thClass}>
                  État
                </th>
                <th scope="col" className={thClass}>
                  Dernière synchronisation
                </th>
                <th scope="col" className={thClass}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {connections.map((connection) => (
                <tr key={connection.id}>
                  <td className={tdClass}>
                    <span className="font-medium">{connection.provider}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      scopes : {SCOPES[connection.provider]}
                    </span>
                  </td>
                  <td className={tdClass}>
                    {describeInstance(connection.provider, connection.instanceUrl)}
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {connection.externalOwner ?? "tous les accès du jeton"}
                    </span>
                  </td>
                  <td className={tdClass}>
                    {connection.status === "CONNECTED" && connection.lastSyncedAt ? (
                      <>
                        <Badge tone={isStaleAt(connection.lastSyncedAt) ? "warning" : "positive"}>
                          {connection.projectCount} projet(s)
                          {isStaleAt(connection.lastSyncedAt) ? " — données anciennes" : ""}
                        </Badge>
                        {ISSUE_TRACKING_PROVIDERS.includes(connection.provider) ? (
                          <span className="mt-1 block">
                            <Badge tone={connection.issueCount > 0 ? "warning" : "neutral"}>
                              {connection.issueCount} issue(s) ouverte(s)
                            </Badge>
                          </span>
                        ) : null}
                      </>
                    ) : connection.status === "ERROR" ? (
                      <Badge tone="negative">
                        Erreur{connection.lastSyncError ? ` — ${connection.lastSyncError}` : ""}
                      </Badge>
                    ) : (
                      <Badge tone="warning">Jamais synchronisé</Badge>
                    )}
                  </td>
                  <td className={tdClass}>
                    {connection.lastSyncedAt ? (
                      formatInstant(connection.lastSyncedAt)
                    ) : (
                      <span className="text-zinc-500 dark:text-zinc-400">Aucune</span>
                    )}
                  </td>
                  <td className={tdClass}>
                    <form action={syncConnectionAction}>
                      <input type="hidden" name="connectionId" value={connection.id} />
                      {/* A synchronisation must not lose the repository being read. */}
                      <input
                        type="hidden"
                        name="repository"
                        value={selectedRepository ?? ""}
                      />
                      <button
                        type="submit"
                        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        Synchroniser
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>

      <Card
        title="Synchronisations"
        description="Chaque passage est conservé : état, volumes et durée. Un dépôt non lu garde ses données inconnues — jamais comptées comme vides."
      >
        {runs.length === 0 ? (
          <EmptyState
            title="Aucune synchronisation"
            description="Aucun passage n'a encore été enregistré. Lancez une synchronisation depuis la table ci-dessus : son détail apparaîtra ici, même après un rafraîchissement."
          />
        ) : (
          <TableShell caption="Dernière synchronisation par connexion">
            <thead>
              <tr>
                <th scope="col" className={thClass}>Connexion</th>
                <th scope="col" className={thClass}>Résultat</th>
                <th scope="col" className={thClass}>Terminé</th>
                <th scope="col" className={thClass}>Durée</th>
                <th scope="col" className={thClass}>Lus</th>
                <th scope="col" className={thClass}>Créés</th>
                <th scope="col" className={thClass}>Mis à jour</th>
                <th scope="col" className={thClass}>Ignorés</th>
                <th scope="col" className={thClass}>Échecs</th>
                <th scope="col" className={thClass}>Relances</th>
                <th scope="col" className={thClass}>Historique</th>
              </tr>
            </thead>
            <tbody>
              {connections
                .filter((connection) => latestRuns.has(connection.id))
                .map((connection) => {
                  const run = latestRuns.get(connection.id)!;
                  const outcome = describeSyncRun(run, { now });

                  return (
                    <tr key={run.id}>
                      <td className={tdClass}>
                        {connection.provider}
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                          {describeInstance(connection.provider, connection.instanceUrl)}
                        </span>
                      </td>
                      <td className={tdClass}>
                        <Badge tone={outcome.tone}>{outcome.label}</Badge>
                        {outcome.note ? (
                          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                            {outcome.note}
                          </span>
                        ) : null}
                      </td>
                      <td className={tdClass}>
                        {run.finishedAt ? formatInstant(run.finishedAt) : "—"}
                      </td>
                      <td className={tdClass}>
                        {formatRunDuration(run.startedAt, run.finishedAt)}
                      </td>
                      <td className={tdClass}>{run.fetched}</td>
                      <td className={tdClass}>{run.created}</td>
                      <td className={tdClass}>{run.updated}</td>
                      <td className={tdClass}>{run.skipped}</td>
                      <td className={tdClass}>{run.failed}</td>
                      <td className={tdClass}>{run.retries}</td>
                      <td className={tdClass}>
                        <a href="#historique-synchronisations" className="underline">
                          Voir
                        </a>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </TableShell>
        )}
      </Card>

      {runs.length > 0 ? (
        <div id="historique-synchronisations">
          <Card
            title="Historique des synchronisations"
            description="Les 50 derniers passages, du plus récent au plus ancien. La politique de conservation est documentée dans docs/architecture/overview.md."
          >
            <TableShell caption="Historique des synchronisations">
              <thead>
                <tr>
                  <th scope="col" className={thClass}>Terminé</th>
                  <th scope="col" className={thClass}>Connexion</th>
                  <th scope="col" className={thClass}>Résultat</th>
                  <th scope="col" className={thClass}>Durée</th>
                  <th scope="col" className={thClass}>Lus</th>
                  <th scope="col" className={thClass}>Créés</th>
                  <th scope="col" className={thClass}>Mis à jour</th>
                  <th scope="col" className={thClass}>Ignorés</th>
                  <th scope="col" className={thClass}>Échecs</th>
                  <th scope="col" className={thClass}>Relances</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const outcome = describeSyncRun(run, { now });

                  return (
                    <tr key={run.id}>
                      <td className={tdClass}>
                        {run.finishedAt ? formatInstant(run.finishedAt) : "—"}
                      </td>
                      <td className={tdClass}>
                        {run.provider}
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                          {run.connectionLabel}
                        </span>
                      </td>
                      <td className={tdClass}>
                        <Badge tone={outcome.tone}>{outcome.label}</Badge>
                        {outcome.note ? (
                          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                            {outcome.note}
                          </span>
                        ) : null}
                      </td>
                      <td className={tdClass}>
                        {formatRunDuration(run.startedAt, run.finishedAt)}
                      </td>
                      <td className={tdClass}>{run.fetched}</td>
                      <td className={tdClass}>{run.created}</td>
                      <td className={tdClass}>{run.updated}</td>
                      <td className={tdClass}>{run.skipped}</td>
                      <td className={tdClass}>{run.failed}</td>
                      <td className={tdClass}>{run.retries}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>
          </Card>
        </div>
      ) : null}

      <IssuesCard
        issues={issues}
        issueTrackingConnected={issueConnections.length > 0}
        lastSyncedAt={lastIssueSync}
        selectedRepository={selectedRepository}
      />

      {issueConnections.length > 0 ? (
        <>
          <IssueExplorer
            issues={filteredIssues}
            totalCount={issues.length}
            filters={filters}
            options={filterOptions}
          />

          <MilestonesCard milestones={milestones} lastSyncedAt={lastIssueSync} />
        </>
      ) : null}

      <Card
        title="Ajouter ou remplacer une connexion"
        description="Créez un jeton dédié en lecture seule. Le jeton est chiffré avant d'être enregistré (AES-256-GCM)."
      >
        <form action={connectProviderAction} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Fournisseur</span>
            <select
              name="provider"
              required
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {INTEGRATION_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">URL d&apos;instance</span>
            <input
              name="instanceUrl"
              placeholder="https://gitlab.example.com (vide = instance publique)"
              className="w-72 rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Organisation ou groupe</span>
            <input
              name="externalOwner"
              placeholder="Optionnel"
              className="w-56 rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Jeton (lecture seule)</span>
            <input
              name="token"
              type="password"
              required
              autoComplete="off"
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Enregistrer
          </button>
        </form>
      </Card>

      <Notice tone="warning">
        Avant de connecter un GitLab d&apos;entreprise, vérifiez la politique interne :
        seuls les projets explicitement autorisés doivent être suivis. Le dashboard ne
        copie aucun contenu de code source.
      </Notice>
    </>
  );
}
