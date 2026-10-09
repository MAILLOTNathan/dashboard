import Decimal from "decimal.js";
import Link from "next/link";
import { Card, Notice, StatCard, tdClass, thClass } from "@/components/ui";
import { formatMonthLabel, parseMonthKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { listAccounts, listAccountBalanceTotals, listRecurringEntries } from "@/modules/budget/repository";
import {
  buildSavingsThresholds,
  savingsWindow,
  type SavingsAccount,
  type SavingsThreshold,
} from "@/modules/budget/savings";

/**
 * Recommended savings threshold: six months of expected expenses, as a target for the
 * savings accounts.
 *
 * Nothing is stored — the figure is recomputed from the recurring series (Prévisions
 * tab) at every visit, so it follows reality as soon as a series changes. The rules,
 * constants and edge cases live in `src/modules/budget/savings.ts` and are documented
 * in `docs/architecture/overview.md`.
 */
export async function SavingsThresholdCard({ userId }: { userId: string }) {
  const [entries, accounts, balanceTotals] = await Promise.all([
    listRecurringEntries(userId),
    listAccounts(userId),
    listAccountBalanceTotals(userId),
  ]);

  const currencyByAccount = new Map(accounts.map((account) => [account.id, account.currency]));
  const byAccount = new Map(balanceTotals.map((total) => [total.accountId, total]));

  // Only accounts explicitly typed as savings: a checking account is not a cushion.
  const savingsAccounts: SavingsAccount[] = accounts
    .filter((account) => account.type === "SAVINGS")
    .map((account) => ({
      accountId: account.id,
      accountName: account.name,
      currency: account.currency,
      transactionCount: byAccount.get(account.id)?.transactionCount ?? 0,
      balance: byAccount.get(account.id)?.balance ?? new Decimal(0),
    }));

  const months = savingsWindow();
  const thresholds = buildSavingsThresholds({
    entries,
    currencyByAccount,
    savingsAccounts,
    months,
  });

  return (
    <Card
      title="Seuil d'épargne conseillé"
      description="Six mois de dépenses prévues, mois en cours compris, calculés à partir des séries récurrentes des prévisions. Rien n'est stocké : le seuil se recalcule à chaque visite. Les devises ne sont jamais converties, et un compte d'épargne sans opération enregistrée reste inconnu — jamais zéro."
    >
      {thresholds.length === 0 ? (
        <Notice tone="info">
          Aucune dépense prévue par une série récurrente sur les 6 prochains mois : le
          seuil ne peut pas être calculé, ce qui n&apos;est pas un seuil à zéro.{" "}
          <Link href="/budget?tab=forecast" className="underline underline-offset-2">
            Définir des prévisions
          </Link>
          .
        </Notice>
      ) : (
        <div className="flex flex-col gap-6">
          {thresholds.map((threshold) => (
            <CurrencyThreshold key={threshold.currency} threshold={threshold} />
          ))}
        </div>
      )}
    </Card>
  );
}

function CurrencyThreshold({ threshold }: { threshold: SavingsThreshold }) {
  const currency = threshold.currency;
  const hasAccount = threshold.savingsAccountCount > 0;
  const balance = threshold.savingsBalance;
  const shortfall = threshold.shortfall;
  const reached = shortfall !== null && !shortfall.greaterThan(0);

  const balanceHint = !hasAccount
    ? `Aucun compte d'épargne en ${currency} : le type « Compte d'épargne » marque un compte comme tel.`
    : balance === null
      ? "Aucune opération enregistrée sur ces comptes : le solde est inconnu, pas zéro."
      : `${threshold.recordedAccountCount} compte${threshold.recordedAccountCount > 1 ? "s" : ""} d'épargne, solde enregistré.`;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={`Seuil conseillé (${currency})`}
          value={formatMoney({ amount: threshold.expectedTotal, currency })}
          hint={`6 mois de dépenses prévues · ${threshold.seriesCount} série${
            threshold.seriesCount > 1 ? "s" : ""
          }`}
        />
        <StatCard
          label={`Épargne enregistrée (${currency})`}
          value={balance === null ? "—" : formatMoney({ amount: balance, currency })}
          hint={balanceHint}
        />
        <StatCard
          label="Reste à constituer"
          value={shortfall === null ? "—" : shortfall.greaterThan(0) ? formatMoney({ amount: shortfall, currency }) : "Seuil couvert"}
          tone={shortfall === null ? "neutral" : shortfall.greaterThan(0) ? "warning" : "positive"}
          hint={
            shortfall === null
              ? "Inconnu tant que le solde d'épargne n'est pas enregistré."
              : shortfall.greaterThan(0)
                ? "Seuil − épargne enregistrée."
                : "Le coussin dépasse le seuil recommandé."
          }
        />
        <StatCard
          label="Équivalent en mois"
          value={
            threshold.runwayMonths === null
              ? "—"
              : `${new Intl.NumberFormat("fr-FR", {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                }).format(threshold.runwayMonths.toNumber())} mois`
          }
          tone={reached ? "positive" : "neutral"}
          hint={
            threshold.runwayMonths === null
              ? "Inconnu tant que le solde d'épargne n'est pas enregistré."
              : "Épargne enregistrée ÷ dépenses prévues moyennes : 6,0 mois couvre le seuil conseillé."
          }
        />
      </div>

      {threshold.progress !== null && !threshold.progress.isNaN() ? (
        <div className="flex items-center gap-2">
          <span
            className="block h-1.5 w-40 rounded-full bg-zinc-200 dark:bg-zinc-800"
            aria-hidden="true"
          >
            <span
              className={`block h-1.5 rounded-full ${
                reached ? "bg-emerald-600" : "bg-amber-500"
              }`}
              style={{ width: `${Math.min(100, Math.max(0, threshold.progress.toNumber()))}%` }}
            />
          </span>
          <span className="text-xs tabular-nums">
            {new Intl.NumberFormat("fr-FR", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            }).format(threshold.progress.toNumber())}{" "}
            % du seuil
          </span>
        </div>
      ) : null}

      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Détail des 6 mois — {currency}
        </summary>
        <div className="pt-2">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Dépenses prévues mois par mois pour le seuil d&apos;épargne
            </caption>
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Mois
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Dépenses prévues
                </th>
              </tr>
            </thead>
            <tbody>
              {threshold.months.map((month) => {
                const { year, month: monthNumber } = parseMonthKey(month.monthKey);
                return (
                  <tr key={month.monthKey}>
                    <td className={tdClass}>{formatMonthLabel(year, monthNumber)}</td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {formatMoney({ amount: month.amount, currency })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className={`${tdClass} font-medium`}>Total — seuil conseillé</td>
                <td className={`${tdClass} whitespace-nowrap text-right font-medium tabular-nums`}>
                  {formatMoney({ amount: threshold.expectedTotal, currency })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </details>
    </div>
  );
}
