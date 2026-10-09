import Decimal from "decimal.js";
import Link from "next/link";
import { Badge, Card, EmptyState, Notice, tdClass, thClass } from "@/components/ui";
import { formatDateOnly, formatMonthLabel, monthRange, parseMonthKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ACCOUNT_TYPE_LABELS } from "@/modules/budget/domain";
import { projectAccountBalance } from "@/modules/budget/projection";
import {
  listAccountBalanceTotals,
  listAccountsForManagement,
  listCategoryUsage,
  listPendingOccurrenceAmounts,
} from "@/modules/budget/repository";
import { AccountsManager, type ManagedAccount } from "./accounts-manager";
import { CategoriesManager } from "./categories-manager";

/**
 * "Comptes" tab: balances, the projected end-of-month balance, and the management of
 * accounts and categories.
 *
 * The projection rule is the one documented in `src/modules/budget/projection.ts`:
 * recorded balance + the month's pending occurrences. For a past month, it reads as
 * "what was still to be processed" rather than a forecast — the card says so. An account
 * with no recorded transaction keeps an **unknown** balance and no projection: nothing
 * recorded is not zero. The simulated salary is deliberately absent from the projection
 * (no account owns it until it is booked) and the card says that too.
 */
export async function AccountsSection({
  userId,
  monthKey,
}: {
  userId: string;
  monthKey: string;
}) {
  const { year, month } = parseMonthKey(monthKey);
  const range = monthRange(year, month);
  const monthLabel = formatMonthLabel(year, month);

  const [accounts, balanceTotals, pendingOccurrences, categories] = await Promise.all([
    listAccountsForManagement(userId),
    listAccountBalanceTotals(userId),
    listPendingOccurrenceAmounts(userId, { from: range.start, to: range.end }),
    listCategoryUsage(userId),
  ]);

  const balanceByAccount = new Map(balanceTotals.map((total) => [total.accountId, total]));
  const pendingByAccount = new Map<
    string,
    { type: "INCOME" | "EXPENSE"; amount: Decimal }[]
  >();

  for (const occurrence of pendingOccurrences) {
    const list = pendingByAccount.get(occurrence.accountId) ?? [];
    list.push({ type: occurrence.type, amount: occurrence.amount });
    pendingByAccount.set(occurrence.accountId, list);
  }

  const rows = accounts.map((account) => {
    const recorded = balanceByAccount.get(account.id) ?? {
      transactionCount: 0,
      balance: new Decimal(0),
      lastOperationDate: null as Date | null,
    };
    const projection = projectAccountBalance({
      recorded,
      pending: pendingByAccount.get(account.id) ?? [],
    });

    return { account, recorded, projection };
  });

  const managedAccounts: ManagedAccount[] = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    archived: account.archivedAt !== null,
    transactionCount: balanceByAccount.get(account.id)?.transactionCount ?? 0,
  }));

  return (
    <>
      <Card
        title={`Soldes et projection — fin ${monthLabel}`}
        description="Solde enregistré : somme signée des opérations du compte. Solde projeté : solde enregistré + échéances du mois affiché encore en attente de décision. Sur un mois passé, lisez-le comme « ce qui restait à traiter ». Le salaire simulé non enregistré n'est attribué à aucun compte : il reste dans Prévisions."
      >
        {rows.length === 0 ? (
          <EmptyState
            title="Aucun compte"
            description="Créez un compte dans l'onglet Opérations : c'est lui qui porte la devise des opérations."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <caption className="sr-only">Soldes par compte</caption>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>
                    Compte
                  </th>
                  <th scope="col" className={thClass}>
                    Type
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Solde enregistré
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Échéances en attente
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Solde projeté
                  </th>
                  <th scope="col" className={thClass}>
                    Dernière opération
                  </th>
                  <th scope="col" className={thClass}>
                    État
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ account, recorded, projection }) => (
                  <tr key={account.id}>
                    <td className={tdClass}>{account.name}</td>
                    <td className={tdClass}>{ACCOUNT_TYPE_LABELS[account.type]}</td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {recorded.transactionCount === 0
                        ? "— (aucune opération)"
                        : formatMoney({ amount: recorded.balance, currency: account.currency })}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {projection.pendingCount === 0
                        ? "—"
                        : formatMoney({ amount: projection.pendingNet, currency: account.currency })}
                      {projection.pendingCount > 0 ? (
                        <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400">
                          ({projection.pendingCount})
                        </span>
                      ) : null}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {projection.kind === "KNOWN" ? (
                        formatMoney({ amount: projection.projected, currency: account.currency })
                      ) : (
                        <span
                          className="text-xs text-zinc-500 dark:text-zinc-400"
                          title={projection.reason}
                        >
                          — solde de départ inconnu
                        </span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {recorded.lastOperationDate === null
                        ? "—"
                        : formatDateOnly(recorded.lastOperationDate)}
                    </td>
                    <td className={tdClass}>
                      {account.archivedAt === null ? (
                        <Badge>Actif</Badge>
                      ) : (
                        <Badge tone="warning">Archivé</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Gérer les comptes"
        description="Renommer, changer le type, archiver ou réactiver. Un compte porteur d'opérations garde sa devise : rien n'est converti. L'archivage retire le compte des formulaires et des alertes sans toucher à son historique."
      >
        {managedAccounts.length === 0 ? (
          <Notice tone="info">Aucun compte à gérer pour l&apos;instant.</Notice>
        ) : (
          <AccountsManager accounts={managedAccounts} />
        )}
      </Card>

      <Card
        title="Catégories"
        description="Renommer, fusionner ou supprimer. La fusion déplace opérations, séries et budgets vers la catégorie cible et indique combien de budgets en doublon ont été supprimés ; la suppression détache les opérations (les montants restent) et supprime les budgets de la catégorie."
        actions={
          <Link
            href="/budget?tab=operations"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Créer une catégorie
          </Link>
        }
      >
        <CategoriesManager categories={categories} />
      </Card>
    </>
  );
}
