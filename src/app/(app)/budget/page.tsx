import Link from "next/link";
import {
  Card,
  EmptyState,
  Notice,
  PageHeader,
  StatCard,
  TableShell,
  tdClass,
  thClass,
} from "@/components/ui";
import { requireUser } from "@/lib/auth/guard";
import {
  currentMonthKey,
  formatDateOnly,
  formatMonthLabel,
  monthRange,
  parseMonthKey,
} from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import {
  TRANSACTION_TYPES,
  type TransactionType,
} from "@/modules/budget/domain";
import { listAccounts, listCategories, listTransactions } from "@/modules/budget/repository";
import { computeTotalsByCurrency } from "@/modules/budget/totals";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<TransactionType, string> = {
  INCOME: "Recette",
  EXPENSE: "Dépense",
  TRANSFER: "Transfert",
};

type SearchParams = Record<string, string | string[] | undefined>;

function readParam(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const monthKey = /^\d{4}-\d{2}$/.test(readParam(params, "month") ?? "")
    ? (readParam(params, "month") as string)
    : currentMonthKey();

  const { year, month } = parseMonthKey(monthKey);
  const range = monthRange(year, month);

  const accountId = readParam(params, "account");
  const categoryId = readParam(params, "category");
  const rawType = readParam(params, "type");
  const type = TRANSACTION_TYPES.find((value) => value === rawType);
  const search = readParam(params, "q");

  const [accounts, categories, transactions] = await Promise.all([
    listAccounts(user.id),
    listCategories(user.id),
    listTransactions(user.id, {
      from: range.start,
      to: range.end,
      accountId,
      categoryId,
      type,
      search,
    }),
  ]);

  const totals = computeTotalsByCurrency(transactions);
  const hasAccounts = accounts.length > 0;
  const exportParams = new URLSearchParams({ month: monthKey });
  if (accountId) exportParams.set("account", accountId);
  if (categoryId) exportParams.set("category", categoryId);
  if (type) exportParams.set("type", type);
  if (search) exportParams.set("q", search);

  return (
    <>
      <PageHeader
        title="Budget"
        description={`Opérations de ${formatMonthLabel(year, month)}. Les montants sont signés : une sortie est négative.`}
        actions={
          <Link
            href={`/api/export/transactions?${exportParams.toString()}`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Exporter en CSV
          </Link>
        }
      />

      {!hasAccounts ? (
        <Notice tone="warning">
          Aucun compte n&apos;est enregistré. Créez d&apos;abord un compte de suivi manuel :
          aucune donnée bancaire n&apos;est importée automatiquement.
        </Notice>
      ) : null}

      <Card title="Filtres">
        <form method="get" action="/budget" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Mois</span>
            <input
              type="month"
              name="month"
              defaultValue={monthKey}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Compte</span>
            <select
              name="account"
              defaultValue={accountId ?? ""}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">Tous</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Catégorie</span>
            <select
              name="category"
              defaultValue={categoryId ?? ""}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">Toutes</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Type</span>
            <select
              name="type"
              defaultValue={type ?? ""}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">Tous</option>
              {TRANSACTION_TYPES.map((value) => (
                <option key={value} value={value}>
                  {TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Libellé contient</span>
            <input
              type="search"
              name="q"
              defaultValue={search ?? ""}
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
              href="/budget"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Réinitialiser
            </Link>
          </div>
        </form>
      </Card>

      {totals.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {totals.map((monthly) => (
            <div key={monthly.currency} className="contents">
              <StatCard
                label={`Recettes (${monthly.currency})`}
                value={formatMoney({ amount: monthly.income, currency: monthly.currency })}
              />
              <StatCard
                label={`Dépenses (${monthly.currency})`}
                value={formatMoney({ amount: monthly.expenses, currency: monthly.currency })}
              />
              <StatCard
                label={`Solde (${monthly.currency})`}
                value={formatMoney({ amount: monthly.net, currency: monthly.currency })}
                tone={monthly.net.isNegative() ? "negative" : "positive"}
                hint="Hors transferts."
              />
              <StatCard
                label={`Transferts (${monthly.currency})`}
                value={formatMoney({ amount: monthly.transfers, currency: monthly.currency })}
                hint="Exclus du solde."
              />
            </div>
          ))}
        </div>
      ) : null}

      <Card
        title={`${transactions.length} opération${transactions.length > 1 ? "s" : ""}`}
        description="L'édition directe dans le tableau n'est pas encore implémentée : les opérations se créent depuis le module budget."
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
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td className={`${tdClass} whitespace-nowrap tabular-nums`}>
                    {formatDateOnly(transaction.operationDate)}
                  </td>
                  <td className={tdClass}>
                    {transaction.label}
                    {transaction.externalRef ? (
                      <span className="ml-2 text-xs text-zinc-400">
                        (import {transaction.externalRef})
                      </span>
                    ) : null}
                  </td>
                  <td className={tdClass}>{transaction.accountName ?? "—"}</td>
                  <td className={tdClass}>{transaction.categoryName ?? "—"}</td>
                  <td className={tdClass}>{TYPE_LABELS[transaction.type]}</td>
                  <td
                    className={`${tdClass} whitespace-nowrap text-right tabular-nums ${
                      transaction.amount.isNegative() ? "text-rose-700 dark:text-rose-400" : ""
                    }`}
                  >
                    {formatMoney({
                      amount: transaction.amount,
                      currency: transaction.currency,
                    })}
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
