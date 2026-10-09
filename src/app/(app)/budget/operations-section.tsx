import Link from "next/link";
import {
  Card,
  EmptyState,
  Notice,
} from "@/components/ui";
import { formatDateOnly, monthRange, parseMonthKey, toDateOnlyString } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import {
  toTransactionFormInitialValues,
} from "@/modules/budget/domain";
import {
  countTransactions,
  findTransaction,
  listAccounts,
  listCategories,
  listLabelHistory,
  listTransactions,
  TRANSACTION_PAGE_SIZE,
  type TransactionSort,
} from "@/modules/budget/repository";
import { buildLabelSuggestions } from "@/modules/budget/suggestions";
import { findCashflowLinkedToTransaction } from "@/modules/real-estate/repository";
import { AccountForm } from "./account-form";
import { BudgetFilters, type BudgetFilterValues } from "./budget-filters";
import { CategoryForm } from "./category-form";
import { OperationsTable, type OperationsTableRow } from "./operations-table";
import { TransactionForm } from "./transaction-form";
import { TransferForm } from "./transfer-form";

const TYPE_LABELS: Record<"INCOME" | "EXPENSE" | "TRANSFER", string> = {
  INCOME: "Recette",
  EXPENSE: "Dépense",
  TRANSFER: "Transfert",
};

/**
 * "Opérations" tab: entry, filters, the month's list (editable in place) and the
 * corrections.
 *
 * The section reads its own data, so the charts' window (up to `SERIES_ROW_LIMIT` rows)
 * is never fetched just to display this tab. The list is paginated — the previous version
 * silently cut at 200 rows — and the same filters drive the count, the page links and the
 * CSV export, so a displayed page and an exported file never disagree about what was
 * selected.
 */
export async function OperationsSection({
  userId,
  monthKey,
  filters,
  editId,
  copyId,
  sort,
  dir,
  page,
  scopeAll,
}: {
  userId: string;
  /** `YYYY-MM`, the month shared by every tab. */
  monthKey: string;
  filters: BudgetFilterValues;
  /** `?edit=`, an identifier to look up: a foreign one finds nothing. */
  editId?: string;
  /** `?copy=`, the row a new one is pre-filled from; nothing is written until submit. */
  copyId?: string;
  sort?: TransactionSort;
  dir: "asc" | "desc";
  /** 1-based page of the paginated list. */
  page: number;
  /** True when the search was widened to every month. */
  scopeAll: boolean;
}) {
  const { year, month } = parseMonthKey(monthKey);
  const range = monthRange(year, month);
  const today = toDateOnlyString(new Date());

  const readFilters = {
    // "Tous les mois" widens the window; everything else about the filters stays.
    ...(scopeAll ? {} : { from: range.start, to: range.end }),
    accountId: filters.accountId,
    categoryId: filters.categoryId,
    type: filters.type,
    search: filters.search,
    reconciled: filters.reconciled,
  };

  const [
    accounts,
    categories,
    transactions,
    totalCount,
    labelHistory,
    editTarget,
    editLink,
    copyTarget,
  ] = await Promise.all([
    listAccounts(userId),
    listCategories(userId),
    listTransactions(userId, {
      ...readFilters,
      sort,
      dir,
      skip: (page - 1) * TRANSACTION_PAGE_SIZE,
      take: TRANSACTION_PAGE_SIZE,
    }),
    countTransactions(userId, readFilters),
    // Deliberately unfiltered: a suggestion is worth offering whatever month or
    // account is being displayed.
    listLabelHistory(userId),
    editId ? findTransaction(userId, editId) : Promise.resolve(null),
    // Read only while editing: the form warns when a correction also moves the totals of
    // a property, which is the case only for a transaction a cashflow points at.
    editId ? findCashflowLinkedToTransaction(userId, editId) : Promise.resolve(null),
    copyId ? findTransaction(userId, copyId) : Promise.resolve(null),
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

  // Same rule for a copy: the form's account list must contain the row's account.
  const copying =
    !editing && copyTarget && accounts.some((account) => account.id === copyTarget.accountId)
      ? copyTarget
      : null;
  const copyTargetIsHidden = Boolean(copyId) && !editing && copying === null;

  // The row may sit outside the displayed month, or be hidden by a filter: the table would
  // not show it and the form would look like it appeared out of nowhere.
  const editingIsOutOfView =
    editing !== null && !transactions.some((transaction) => transaction.id === editing.id);

  // Built once: the row links, the sort headers and the pagination must carry the same
  // month, filters, scope and sort, or acting would silently change what is displayed.
  const listParams = new URLSearchParams({ month: monthKey, tab: "operations" });
  if (filters.accountId) listParams.set("account", filters.accountId);
  if (filters.categoryId) listParams.set("category", filters.categoryId);
  if (filters.type) listParams.set("type", filters.type);
  if (filters.search) listParams.set("q", filters.search);
  if (filters.reconciled !== undefined) {
    listParams.set("reconciled", filters.reconciled ? "1" : "0");
  }
  if (scopeAll) listParams.set("all", "1");
  if (sort) listParams.set("sort", sort);
  if (sort) listParams.set("dir", dir);
  if (page > 1) listParams.set("page", String(page));
  const listHref = `/budget?${listParams.toString()}`;

  // Sort headers: clicking the active column flips the direction, a new column starts on
  // its natural one (most recent first for dates and amounts, A→Z for labels).
  const sortHref = (column: TransactionSort): string => {
    const params = new URLSearchParams(listParams);
    params.set("sort", column);
    params.set(
      "dir",
      sort === column ? (dir === "asc" ? "desc" : "asc") : column === "label" ? "asc" : "desc",
    );
    params.delete("page");
    return `/budget?${params.toString()}`;
  };
  const sortHrefs = {
    date: sortHref("date"),
    amount: sortHref("amount"),
    label: sortHref("label"),
  };

  const pageCount = Math.max(1, Math.ceil(totalCount / TRANSACTION_PAGE_SIZE));
  const pageHref = (target: number): string => {
    const params = new URLSearchParams(listParams);
    if (target > 1) {
      params.set("page", String(target));
    } else {
      params.delete("page");
    }
    return `/budget?${params.toString()}`;
  };

  const rows: OperationsTableRow[] = transactions.map((transaction) => ({
    id: transaction.id,
    values: toTransactionFormInitialValues(transaction),
    accountName: transaction.accountName ?? "—",
    categoryName: transaction.categoryName,
    typeLabel: TYPE_LABELS[transaction.type],
    amountLabel: formatMoney({ amount: transaction.amount, currency: transaction.currency }),
    dateLabel: formatDateOnly(transaction.operationDate),
    isNegative: transaction.amount.isNegative(),
    reconciled: transaction.reconciledAt !== null,
    reconciledLabel:
      transaction.reconciledAt === null ? null : formatDateOnly(transaction.reconciledAt),
    externalRef: transaction.externalRef,
    transferGroupId: transaction.transferGroupId,
  }));

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

      {copyTargetIsHidden ? (
        <Notice tone="warning">
          L&apos;opération à dupliquer est introuvable, ou son compte n&apos;est plus
          actif. Le formulaire reste en mode création.
        </Notice>
      ) : null}

      <Card
        title={editing ? "Modifier l'opération" : "Saisie"}
        description={
          editing
            ? "Correction d'une opération existante. « Annuler » revient à la saisie sans rien enregistrer."
            : "Ajout manuel. Rien n'est importé d'une banque et rien n'est envoyé à un tiers."
        }
        actions={
          !editing ? (
            <Link
              href="/budget/import"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Importer un CSV
            </Link>
          ) : null
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
                {copying ? "Dupliquer l'opération" : "Nouvelle opération"}
              </summary>
              <div className="pt-3">
                <TransactionForm
                  key={copying?.id ?? "create"}
                  accounts={accounts}
                  categories={categories}
                  labelSuggestions={labelSuggestions}
                  today={today}
                  duplicateOf={copying ? toTransactionFormInitialValues(copying) : null}
                  cancelHref={copying ? listHref : undefined}
                />
              </div>
            </details>
          )}

          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Virement entre comptes (deux mouvements liés)
            </summary>
            <div className="pt-3">
              <TransferForm accounts={accounts} today={today} />
            </div>
          </details>

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
        showAllScope
        allScope={scopeAll}
      />

      <Card
        title={`${totalCount} opération${totalCount > 1 ? "s" : ""}${
          scopeAll ? " (tous les mois)" : " sur le mois affiché"
        }`}
        description="Modifier ouvre l'édition sur place : Entrée enregistre, Échap annule. « Pointer » coche la ligne contre votre relevé bancaire. Supprimer n'est pas annulable ; un virement lié se supprime avec ses deux mouvements."
      >
        {transactions.length === 0 ? (
          page > 1 ? (
            <EmptyState
              title="Cette page est vide"
              description="Le total tient sur moins de pages que celle demandée : revenez à la première page."
              action={
                <Link
                  href={pageHref(1)}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Première page
                </Link>
              }
            />
          ) : (
            <EmptyState
              title="Aucune opération pour ces critères"
              description="Aucune ligne ne correspond au mois et aux filtres sélectionnés. Ce n'est pas un solde à zéro : la liste est simplement vide."
            />
          )
        ) : (
          <>
            <OperationsTable
              rows={rows}
              accounts={accounts}
              categories={categories}
              listHref={listHref}
              sortHrefs={sortHrefs}
              sort={sort}
              dir={dir}
            />

            {pageCount > 1 ? (
              <nav
                aria-label="Pagination des opérations"
                className="mt-3 flex items-center justify-between gap-3 text-sm"
              >
                {page > 1 ? (
                  <Link
                    href={pageHref(page - 1)}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    ← Page précédente
                  </Link>
                ) : (
                  <span />
                )}
                <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
                  Page {page} sur {pageCount}
                </span>
                {page < pageCount ? (
                  <Link
                    href={pageHref(page + 1)}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Page suivante →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
