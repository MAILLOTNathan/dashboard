import Link from "next/link";
import {
  Card,
  EmptyState,
  Notice,
  TableShell,
  tdClass,
  thClass,
} from "@/components/ui";
import { formatDateOnly, monthRange, parseMonthKey, toDateOnlyString } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import {
  toTransactionFormInitialValues,
  type TransactionType,
} from "@/modules/budget/domain";
import {
  findTransaction,
  listAccounts,
  listCategories,
  listLabelHistory,
  listTransactions,
} from "@/modules/budget/repository";
import { buildLabelSuggestions } from "@/modules/budget/suggestions";
import { findCashflowLinkedToTransaction } from "@/modules/real-estate/repository";
import { AccountForm } from "./account-form";
import { BudgetFilters, type BudgetFilterValues } from "./budget-filters";
import { CategoryForm } from "./category-form";
import { DeleteTransactionButton } from "./delete-transaction-button";
import { TransactionForm } from "./transaction-form";

const TYPE_LABELS: Record<TransactionType, string> = {
  INCOME: "Recette",
  EXPENSE: "Dépense",
  TRANSFER: "Transfert",
};

/**
 * "Opérations" tab: entry, filters and the month's list.
 *
 * The section reads its own data, so the charts' window (up to `SERIES_ROW_LIMIT` rows)
 * is never fetched just to display this tab.
 */
export async function OperationsSection({
  userId,
  monthKey,
  filters,
  editId,
}: {
  userId: string;
  /** `YYYY-MM`, the month shared by every tab. */
  monthKey: string;
  filters: BudgetFilterValues;
  /** `?edit=`, an identifier to look up: a foreign one finds nothing. */
  editId?: string;
}) {
  const { year, month } = parseMonthKey(monthKey);
  const range = monthRange(year, month);
  const today = toDateOnlyString(new Date());

  const [accounts, categories, transactions, labelHistory, editTarget, editLink] =
    await Promise.all([
      listAccounts(userId),
      listCategories(userId),
      listTransactions(userId, {
        from: range.start,
        to: range.end,
        ...filters,
      }),
      // Deliberately unfiltered: a suggestion is worth offering whatever month or
      // account is being displayed.
      listLabelHistory(userId),
      editId ? findTransaction(userId, editId) : Promise.resolve(null),
      // Read only while editing: the form warns when a correction also moves the totals of
      // a property, which is the case only for a transaction a cashflow points at.
      editId ? findCashflowLinkedToTransaction(userId, editId) : Promise.resolve(null),
    ]);

  const labelSuggestions = buildLabelSuggestions(labelHistory);

  // A transaction whose account is no longer active cannot be edited from this page: the
  // form lists the active accounts, so it would display — and then submit — an account
  // other than the one the row holds. Refusing beats a silent reassignment.
  const editing =
    editTarget && accounts.some((account) => account.id === editTarget.accountId)
      ? editTarget
      : null;
  // Set whenever an edition was asked for and none can be offered — a row deleted in
  // another tab, or an account that is no longer active. Falling back to the creation form
  // without a word would look like the link did nothing.
  const editTargetIsHidden = Boolean(editId) && editing === null;

  // The row may sit outside the displayed month, or be hidden by a filter: the table would
  // not show it and the form would look like it appeared out of nowhere.
  const editingIsOutOfView =
    editing !== null && !transactions.some((transaction) => transaction.id === editing.id);

  // Built once: the "Modifier" links and their "Annuler" must carry the same month,
  // filters and tab, or correcting a line would silently change what is displayed.
  const listParams = new URLSearchParams({ month: monthKey, tab: "operations" });
  if (filters.accountId) listParams.set("account", filters.accountId);
  if (filters.categoryId) listParams.set("category", filters.categoryId);
  if (filters.type) listParams.set("type", filters.type);
  if (filters.search) listParams.set("q", filters.search);
  const listHref = `/budget?${listParams.toString()}`;

  const hasAccounts = accounts.length > 0;

  return (
    <>
      {!hasAccounts ? (
        <Notice tone="warning">
          Aucun compte n&apos;est enregistré. Créez-en un ci-dessous avant de saisir une
          opération : aucune donnée bancaire n&apos;est importée automatiquement.
        </Notice>
      ) : null}

      {editTargetIsHidden ? (
        <Notice tone="warning">
          L&apos;opération demandée ne peut pas être modifiée ici : son compte n&apos;est
          plus actif, ou elle n&apos;existe plus. Le formulaire reste en mode création.
        </Notice>
      ) : null}

      <Card
        title={editing ? "Modifier l'opération" : "Saisie"}
        description={
          editing
            ? "Correction d'une opération existante. « Annuler » revient à la saisie sans rien enregistrer."
            : "Ajout manuel. Rien n'est importé d'une banque et rien n'est envoyé à un tiers."
        }
      >
        <div className="flex flex-col gap-3">
          {editing ? (
            <div className="flex flex-col gap-3">
              {editingIsOutOfView ? (
                <Notice tone="info">
                  Cette opération est datée du {formatDateOnly(editing.operationDate)},
                  hors du mois ou des filtres affichés : le tableau ci-dessous ne la
                  montre pas.
                </Notice>
              ) : null}

              <TransactionForm
                key={editing.id}
                accounts={accounts}
                categories={categories}
                labelSuggestions={labelSuggestions}
                today={today}
                editing={toTransactionFormInitialValues(editing)}
                linkedPropertyName={editLink?.propertyName ?? null}
                cancelHref={listHref}
              />
            </div>
          ) : (
            <details open>
              <summary className="cursor-pointer text-sm font-medium">
                Nouvelle opération
              </summary>
              <div className="pt-3">
                <TransactionForm
                  accounts={accounts}
                  categories={categories}
                  labelSuggestions={labelSuggestions}
                  today={today}
                />
              </div>
            </details>
          )}

          <details>
            <summary className="cursor-pointer text-sm font-medium">Nouveau compte</summary>
            <div className="pt-3">
              <AccountForm />
            </div>
          </details>

          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Nouvelle catégorie
            </summary>
            <div className="pt-3">
              <CategoryForm />
            </div>
          </details>
        </div>
      </Card>

      <BudgetFilters
        tab="operations"
        monthKey={monthKey}
        accounts={accounts}
        categories={categories}
        values={filters}
      />

      <Card
        title={`${transactions.length} opération${transactions.length > 1 ? "s" : ""}`}
        description="Modifier recharge l'opération dans le formulaire de saisie, filtres conservés. La suppression demande une confirmation et n'est pas annulable : une opération rattachée à un flux immobilier doit être détachée d'abord."
      >
        {transactions.length === 0 ? (
          <EmptyState
            title="Aucune opération pour ces critères"
            description="Aucune ligne ne correspond au mois et aux filtres sélectionnés. Ce n'est pas un solde à zéro : la liste est simplement vide."
          />
        ) : (
          <TableShell caption="Opérations du mois">
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Date
                </th>
                <th scope="col" className={thClass}>
                  Libellé
                </th>
                <th scope="col" className={thClass}>
                  Compte
                </th>
                <th scope="col" className={thClass}>
                  Catégorie
                </th>
                <th scope="col" className={thClass}>
                  Type
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Montant
                </th>
                <th scope="col" className={thClass}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr
                  key={transaction.id}
                  className={
                    editing?.id === transaction.id
                      ? "bg-amber-50 dark:bg-amber-950/30"
                      : undefined
                  }
                >
                  <td className={`${tdClass} whitespace-nowrap tabular-nums`}>
                    {formatDateOnly(transaction.operationDate)}
                  </td>
                  <td className={tdClass}>
                    {transaction.label}
                    {transaction.externalRef ? (
                      <span className="ml-2 text-xs text-zinc-400">
                        (réf. {transaction.externalRef})
                      </span>
                    ) : null}
                  </td>
                  <td className={tdClass}>{transaction.accountName ?? "—"}</td>
                  <td className={tdClass}>{transaction.categoryName ?? "—"}</td>
                  <td className={tdClass}>{TYPE_LABELS[transaction.type]}</td>
                  <td
                    className={`${tdClass} whitespace-nowrap text-right tabular-nums ${
                      transaction.amount.isNegative()
                        ? "text-rose-700 dark:text-rose-400"
                        : ""
                    }`}
                  >
                    {formatMoney({
                      amount: transaction.amount,
                      currency: transaction.currency,
                    })}
                  </td>
                  <td className={tdClass}>
                    <div className="flex flex-col items-start gap-1">
                      <Link
                        href={`${listHref}&edit=${transaction.id}`}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        Modifier
                      </Link>
                      <DeleteTransactionButton
                        transactionId={transaction.id}
                        label={transaction.label}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </>
  );
}
