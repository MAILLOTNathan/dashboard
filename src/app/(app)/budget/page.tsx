import Link from "next/link";
import { CategoryBars, MonthlyTrendChart, type TrendPoint } from "@/components/charts";
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
  formatShortMonthLabel,
  monthKeysEndingAt,
  monthRange,
  parseMonthKey,
  toDateOnlyString,
} from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import {
  TRANSACTION_TYPES,
  toTransactionFormInitialValues,
  type TransactionType,
} from "@/modules/budget/domain";
import {
  findTransaction,
  listAccounts,
  listCategories,
  listLabelHistory,
  listTransactions,
  listTransactionsForSeries,
} from "@/modules/budget/repository";
import { buildCategoryBreakdown, buildMonthlySeries } from "@/modules/budget/series";
import { buildLabelSuggestions } from "@/modules/budget/suggestions";
import {
  computeCumulativeTotal,
  computeTotalsByCurrency,
  groupTransactionsByCurrency,
} from "@/modules/budget/totals";
import { findCashflowLinkedToTransaction } from "@/modules/real-estate/repository";
import { AccountForm } from "./account-form";
import { CategoryForm } from "./category-form";
import { DeleteTransactionButton } from "./delete-transaction-button";
import { TransactionForm } from "./transaction-form";

export const dynamic = "force-dynamic";

/** Months shown on the trend chart: a year is the shortest period that shows a season. */
const TREND_MONTHS = 12;
/** Categories drawn on the breakdown before the tail is merged into "Autres". */
const BREAKDOWN_LIMIT = 8;

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
  // Which side of the ledger the breakdown shows. Expenses by default: that is the
  // question people actually ask.
  const breakdownKind: TransactionType =
    readParam(params, "breakdown") === "INCOME" ? "INCOME" : "EXPENSE";

  // The charts read the same filters as the table, but over a year instead of one
  // month: a trend line built from a single month would say nothing.
  const trendMonthKeys = monthKeysEndingAt(monthKey, TREND_MONTHS);
  const trendStart = monthRange(Number(trendMonthKeys[0].slice(0, 4)), Number(trendMonthKeys[0].slice(5, 7))).start;

  // The row being corrected is read from the owner's own data, never taken from the query
  // string: `?edit=` is only an identifier to look up, so a foreign one finds nothing.
  const editId = readParam(params, "edit");

  const [
    accounts,
    categories,
    transactions,
    series,
    labelHistory,
    editTarget,
    editLink,
  ] = await Promise.all([
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
    listTransactionsForSeries(user.id, {
      from: trendStart,
      to: range.end,
      accountId,
      categoryId,
      type,
      search,
    }),
    // Deliberately unfiltered: a suggestion is worth offering whatever month or
    // account is being displayed.
    listLabelHistory(user.id),
    editId ? findTransaction(user.id, editId) : Promise.resolve(null),
    // Read only while editing: the form warns when a correction also moves the totals of
    // a property, which is the case only for a transaction a cashflow points at.
    editId ? findCashflowLinkedToTransaction(user.id, editId) : Promise.resolve(null),
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

  const totals = computeTotalsByCurrency(transactions);
  const hasAccounts = accounts.length > 0;
  const seriesByCurrency = [...groupTransactionsByCurrency(series.transactions)];
  const totalCumulative = computeCumulativeTotal(
    series.transactions,
    { currency: "EUR" },
  );

  // Built once: the CSV export and the "Modifier" links must carry the same filters, or
  // correcting a line would silently change which month is displayed.
  const filterParams = new URLSearchParams({ month: monthKey });
  if (accountId) filterParams.set("account", accountId);
  if (categoryId) filterParams.set("category", categoryId);
  if (type) filterParams.set("type", type);
  if (search) filterParams.set("q", search);
  const listHref = `/budget?${filterParams.toString()}`;

  return (
		<>
			<PageHeader
				title="Budget"
				description={`Opérations de ${formatMonthLabel(year, month)}. Les montants sont signés : une sortie est négative.`}
				actions={
					<Link
						href={`/api/export/transactions?${filterParams.toString()}`}
						className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
					>
						Exporter en CSV
					</Link>
				}
			/>

			<StatCard
				label={`Solde cumulé (${totals[0].currency})`}
				value={formatMoney({
					amount: totalCumulative,
					currency: totals[0].currency,
				})}
				hint="Solde cumulé depuis le début de l'historique."
			/>

			{!hasAccounts ? (
				<Notice tone="warning">
					Aucun compte n&apos;est enregistré. Créez-en un ci-dessous avant de
					saisir une opération : aucune donnée bancaire n&apos;est importée
					automatiquement.
				</Notice>
			) : null}

			{editTargetIsHidden ? (
				<Notice tone="warning">
					L&apos;opération demandée ne peut pas être modifiée ici : son compte
					n&apos;est plus actif, ou elle n&apos;existe plus. Le formulaire reste
					en mode création.
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
									Cette opération est datée du{" "}
									{formatDateOnly(editing.operationDate)}, hors du mois ou des
									filtres affichés : le tableau ci-dessous ne la montre pas.
								</Notice>
							) : null}

							<TransactionForm
								key={editing.id}
								accounts={accounts}
								categories={categories}
								labelSuggestions={labelSuggestions}
								today={toDateOnlyString(new Date())}
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
									today={toDateOnlyString(new Date())}
								/>
							</div>
						</details>
					)}

					<details>
						<summary className="cursor-pointer text-sm font-medium">
							Nouveau compte
						</summary>
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

			<Card title="Filtres">
				<form
					method="get"
					action="/budget"
					className="flex flex-wrap items-end gap-3"
				>
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
								value={formatMoney({
									amount: monthly.income,
									currency: monthly.currency,
								})}
							/>
							<StatCard
								label={`Dépenses (${monthly.currency})`}
								value={formatMoney({
									amount: monthly.expenses,
									currency: monthly.currency,
								})}
							/>
							<StatCard
								label={`Solde mensuel (${monthly.currency})`}
								value={formatMoney({
									amount: monthly.net,
									currency: monthly.currency,
								})}
								tone={monthly.net.isNegative() ? "negative" : "positive"}
								hint="Transferts inclus."
							/>
							<StatCard
								label={`Transferts (${monthly.currency})`}
								value={formatMoney({
									amount: monthly.transfers,
									currency: monthly.currency,
								})}
								hint="Déjà comptés en recettes ou en dépenses, selon le signe."
							/>
						</div>
					))}
				</div>
			) : null}

			{seriesByCurrency.length === 0 ? (
				<Notice tone="info">
					Aucune opération sur les {TREND_MONTHS} derniers mois : les graphiques
					apparaîtront dès la première saisie. Un graphique vide n&apos;est pas
					un solde à zéro.
				</Notice>
			) : (
				seriesByCurrency.map(([currency, currencyTransactions]) => {
					const windowStart = range.start;
					const points: TrendPoint[] = buildMonthlySeries(
						currencyTransactions,
						trendMonthKeys,
					).map((point) => ({
						monthKey: point.monthKey,
						label: formatShortMonthLabel(point.year, point.month),
						income: point.totals.income,
						expenses: point.totals.expenses,
						net: point.totals.net,
					}));

					const breakdown = buildCategoryBreakdown(
						currencyTransactions.filter(
							(transaction) =>
								transaction.operationDate.getTime() >= windowStart.getTime() &&
								transaction.operationDate.getTime() < range.end.getTime(),
						),
						{ kind: breakdownKind, limit: BREAKDOWN_LIMIT },
					);

					const breakdownParams = new URLSearchParams({ month: monthKey });
					if (accountId) breakdownParams.set("account", accountId);
					if (categoryId) breakdownParams.set("category", categoryId);
					if (type) breakdownParams.set("type", type);
					if (search) breakdownParams.set("q", search);
					breakdownParams.set(
						"breakdown",
						breakdownKind === "EXPENSE" ? "INCOME" : "EXPENSE",
					);

					return (
						<div key={currency} className="flex flex-col gap-4">
							<Card
								title={`Tendance sur ${TREND_MONTHS} mois — ${currency}`}
								description={`Recettes au-dessus de l'axe, dépenses en dessous, mois par mois jusqu'à ${formatMonthLabel(year, month)}. Les transferts entre comptes comptent selon leur signe, comme partout ailleurs.${
									series.truncated
										? " Attention : le nombre d'opérations de la période dépasse la limite de lecture, les totaux affichés sont donc partiels."
										: ""
								}`}
							>
								<MonthlyTrendChart points={points} currency={currency} />
							</Card>

							<Card
								title={`${breakdownKind === "EXPENSE" ? "Où part l'argent" : "D'où vient l'argent"} — ${formatMonthLabel(year, month)}`}
								description="Part de chaque catégorie sur le mois sélectionné, avec les mêmes filtres que le tableau. Une ligne « Sans catégorie » apparaît quand des opérations n'en ont pas, et une ligne « Transferts entre comptes » quand des transferts comptent de ce côté : les bars doivent tomber juste."
								actions={
									<Link
										href={`/budget?${breakdownParams.toString()}`}
										className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
									>
										Voir les{" "}
										{breakdownKind === "EXPENSE" ? "recettes" : "dépenses"}
									</Link>
								}
							>
								<CategoryBars
									entries={breakdown.entries}
									currency={currency}
									total={breakdown.total}
								/>
							</Card>
						</div>
					);
				})
			)}

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
												(import {transaction.externalRef})
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
