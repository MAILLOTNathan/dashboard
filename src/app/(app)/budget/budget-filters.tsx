import Link from "next/link";
import { Card } from "@/components/ui";
import {
  TRANSACTION_TYPES,
  type AccountSummary,
  type CategorySummary,
  type TransactionType,
} from "@/modules/budget/domain";
import type { BudgetTab } from "./budget-tabs";

const TYPE_LABELS: Record<TransactionType, string> = {
  INCOME: "Recette",
  EXPENSE: "Dépense",
  TRANSFER: "Transfert",
};

/** The transaction filters of the budget page. */
export type BudgetFilterValues = {
  accountId?: string;
  categoryId?: string;
  type?: TransactionType;
  search?: string;
};

const fieldClass =
  "rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900";

/**
 * Transaction filters, shared by the operations list and the analysis charts: both read
 * the same query, so they must offer the same controls.
 *
 * The hidden `tab` field keeps the reader on the section they were using once the filters
 * are applied — a plain GET form would otherwise land back on the default tab.
 */
export function BudgetFilters({
  tab,
  monthKey,
  accounts,
  categories,
  values,
}: {
  tab: BudgetTab;
  /** `YYYY-MM`, the month currently displayed. */
  monthKey: string;
  accounts: AccountSummary[];
  categories: CategorySummary[];
  values: BudgetFilterValues;
}) {
  return (
    <Card title="Filtres">
      <form method="get" action="/budget" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value={tab} />

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Mois</span>
          <input type="month" name="month" defaultValue={monthKey} className={fieldClass} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Compte</span>
          <select
            name="account"
            defaultValue={values.accountId ?? ""}
            className={fieldClass}
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
            defaultValue={values.categoryId ?? ""}
            className={fieldClass}
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
          <select name="type" defaultValue={values.type ?? ""} className={fieldClass}>
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
            defaultValue={values.search ?? ""}
            className={`${fieldClass} w-full`}
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
            href={`/budget?tab=${tab}`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Réinitialiser
          </Link>
        </div>
      </form>
    </Card>
  );
}
