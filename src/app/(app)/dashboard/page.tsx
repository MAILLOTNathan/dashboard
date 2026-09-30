import Link from "next/link";
import {
  Badge,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  StatCard,
} from "@/components/ui";
import { requireUser } from "@/lib/auth/guard";
import { formatInstant } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getDashboardOverview } from "@/modules/dashboard/queries";

// Personal financial data must never be served from a static cache.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const overview = await getDashboardOverview(user.id);

  const { budget, realEstate, integrations, monthLabel } = overview;
  const hasAnyTransaction = budget.transactionCount > 0;

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description={`Indicateurs de ${monthLabel}. Chaque total est calculé à partir des opérations enregistrées.`}
        actions={
          <>
            <Link
              href="/budget"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Saisir une opération
            </Link>
            <Link
              href="/api/export/transactions"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Exporter les transactions (CSV)
            </Link>
          </>
        }
      />

      <section aria-labelledby="budget-month" className="flex flex-col gap-3">
        <h2 id="budget-month" className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Budget — {monthLabel}
        </h2>

        {budget.monthTotals.length === 0 ? (
          <EmptyState
            title="Aucune opération sur ce mois"
            description={
              hasAnyTransaction
                ? "Des opérations existent sur d'autres mois. Aucun solde n'est affiché ici pour ne pas laisser croire à un mois à zéro."
                : "Aucune donnée n'a encore été saisie. Le budget se remplit d'abord avec un compte, puis des opérations."
            }
            action={
              <Link
                href="/budget"
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                Ouvrir le budget
              </Link>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {budget.monthTotals.map((totals) => (
              <div key={totals.currency} className="contents">
                <StatCard
                  label={`Recettes (${totals.currency})`}
                  value={formatMoney({ amount: totals.income, currency: totals.currency })}
                />
                <StatCard
                  label={`Dépenses (${totals.currency})`}
                  value={formatMoney({ amount: totals.expenses, currency: totals.currency })}
                />
                <StatCard
                  label={`Solde (${totals.currency})`}
                  value={formatMoney({ amount: totals.net, currency: totals.currency })}
                  tone={totals.net.isNegative() ? "negative" : "positive"}
                  hint="Hors transferts entre comptes."
                />
                <StatCard
                  label={`Transferts (${totals.currency})`}
                  value={formatMoney({ amount: totals.transfers, currency: totals.currency })}
                  hint="Volume déplacé, exclu du solde."
                />
              </div>
            ))}
          </div>
        )}

        <Notice tone="info">
          Le solde mensuel <strong>exclut les transferts entre comptes</strong> : déplacer
          de l&apos;argent d&apos;un compte à l&apos;autre n&apos;est ni une recette ni une
          dépense. Leur volume reste affiché séparément.
        </Notice>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Immobilier"
          description="Biens suivis et flux rattachés."
        >
          {realEstate.propertyCount === 0 ? (
            <EmptyState
              title="Aucun bien enregistré"
              description="Ajoutez un bien pour suivre ses charges, ses recettes et ses échéances."
              action={
                <Link
                  href="/real-estate"
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Gérer l&apos;immobilier
                </Link>
              }
            />
          ) : (
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              {realEstate.propertyCount} bien{realEstate.propertyCount > 1 ? "s" : ""} suivi
              {realEstate.propertyCount > 1 ? "s" : ""}. Le détail des charges et des
              recettes est disponible dans la section Immobilier.
            </p>
          )}
        </Card>

        <Card
          title="Connexions GitHub et GitLab"
          description="Lecture seule. Aucun secret n'est exposé à l'interface."
        >
          {integrations.length === 0 ? (
            <EmptyState
              title="Non connecté"
              description="Aucune connexion n'est configurée. Les projets ne sont donc pas affichés : ce n'est pas la même chose qu'un projet sans activité."
              action={
                <Link
                  href="/integrations"
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Configurer une connexion
                </Link>
              }
            />
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {integrations.map(({ connection, state }) => (
                <li
                  key={connection.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-2 last:border-0 dark:border-zinc-800"
                >
                  <span className="font-medium">
                    {connection.provider}
                    <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                      {connection.externalOwner ?? "compte complet"}
                    </span>
                  </span>

                  {state.kind === "CONNECTED" ? (
                    <Badge tone="positive">
                      {state.projectCount} projet{state.projectCount > 1 ? "s" : ""} —{" "}
                      {formatInstant(state.lastSyncedAt)}
                    </Badge>
                  ) : state.kind === "ERROR" ? (
                    <Badge tone="negative">
                      Erreur de synchronisation
                      {state.lastSyncError ? ` (${state.lastSyncError})` : ""}
                    </Badge>
                  ) : state.kind === "NEVER_SYNCED" ? (
                    <Badge tone="warning">Jamais synchronisé</Badge>
                  ) : (
                    <Badge>Non connecté</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
