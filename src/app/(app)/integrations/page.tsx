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
import {
  describeInstance,
  INTEGRATION_PROVIDERS,
  type IntegrationProvider,
} from "@/modules/integrations/domain";
import { listConnections } from "@/modules/integrations/repository";
import { connectProviderAction, syncConnectionAction } from "./actions";

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

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const connections = await listConnections(user.id);

  const status = typeof params.status === "string" ? params.status : undefined;
  const sync = typeof params.sync === "string" ? params.sync : undefined;
  const projectCount = typeof params.projects === "string" ? params.projects : undefined;
  const reason = typeof params.reason === "string" ? params.reason : undefined;
  const code = typeof params.code === "string" ? params.code : undefined;

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
          Synchronisation terminée : {projectCount ?? "0"} projet(s) autorisé(s) mis à jour.
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
                      <Badge tone="positive">{connection.projectCount} projet(s)</Badge>
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
