import Link from "next/link";
import {
  Badge,
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
import { formatDateOnly } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { listTransactions } from "@/modules/budget/repository";
import { listProperties } from "@/modules/real-estate/repository";
import type { PropertyOccupancy } from "@/modules/real-estate/domain";
import { CashflowForm, type TransactionOption } from "./cashflow-form";
import { PropertyForm } from "./property-form";

export const dynamic = "force-dynamic";

/** Enough recent operations to pick from without loading the whole history. */
const TRANSACTION_OPTION_LIMIT = 100;

const OCCUPANCY_LABELS: Record<PropertyOccupancy, string> = {
  RENTED: "Loué",
  VACANT: "Vacant",
  OWNER_OCCUPIED: "Occupé par le propriétaire",
  SEASONAL: "Saisonnier",
  OTHER: "Autre",
};

export default async function RealEstatePage() {
  const user = await requireUser();
  const [properties, recentTransactions] = await Promise.all([
    listProperties(user.id),
    // A cashflow entry can be linked to an operation recorded in the budget.
    listTransactions(user.id, { take: TRANSACTION_OPTION_LIMIT }),
  ]);

  // Reduced to strings: the form is a client component and never receives a Decimal.
  const transactionOptions: TransactionOption[] = recentTransactions.map((transaction) => ({
    id: transaction.id,
    label: transaction.label,
    date: formatDateOnly(transaction.operationDate),
    amountText: formatMoney({ amount: transaction.amount, currency: transaction.currency }),
  }));

  const rentedCount = properties.filter((property) => property.occupancy === "RENTED").length;
  const vacantCount = properties.filter((property) => property.occupancy === "VACANT").length;

  return (
    <>
      <PageHeader
        title="Immobilier"
        description="Biens, charges et recettes. Un bien n'est pas supposé loué : son statut d'occupation est explicite."
        actions={
          <Link
            href="/api/export/properties"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Exporter en CSV
          </Link>
        }
      />

      <Card
        title="Saisie"
        description="Ajout manuel des biens et de leurs flux. Aucun bien n'est présumé loué."
      >
        <div className="flex flex-col gap-3">
          <details open>
            <summary className="cursor-pointer text-sm font-medium">Nouveau bien</summary>
            <div className="pt-3">
              <PropertyForm />
            </div>
          </details>

          <details>
            <summary className="cursor-pointer text-sm font-medium">Nouveau flux</summary>
            <div className="pt-3">
              <CashflowForm
                properties={properties.map((property) => ({
                  id: property.id,
                  name: property.name,
                }))}
                transactions={transactionOptions}
              />
            </div>
          </details>
        </div>
      </Card>

      {properties.length === 0 ? (
        <EmptyState
          title="Aucun bien enregistré"
          description="Ajoutez un bien pour suivre ses charges, ses recettes locatives éventuelles et ses échéances. Aucun bien n'est présumé loué."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Biens suivis" value={String(properties.length)} />
            <StatCard label="Loués" value={String(rentedCount)} />
            <StatCard label="Vacants" value={String(vacantCount)} />
          </div>

          <Card
            title="Détail par bien"
            description="Les flux liés à une transaction ne sont comptés qu'une seule fois."
          >
            <TableShell caption="Biens et flux rattachés">
              <thead>
                <tr>
                  <th scope="col" className={thClass}>
                    Bien
                  </th>
                  <th scope="col" className={thClass}>
                    Occupation
                  </th>
                  <th scope="col" className={thClass}>
                    Flux
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Recettes
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Charges
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Solde
                  </th>
                </tr>
              </thead>
              <tbody>
                {properties.map((property) => (
                  <tr key={property.id}>
                    <td className={tdClass}>
                      <span className="font-medium">{property.name}</span>
                      {property.address ? (
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                          {property.address}
                        </span>
                      ) : null}
                      {property.purchaseDate ? (
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                          Acquis le {formatDateOnly(property.purchaseDate)}
                        </span>
                      ) : null}
                    </td>
                    <td className={tdClass}>
                      <Badge tone={property.occupancy === "RENTED" ? "positive" : "neutral"}>
                        {OCCUPANCY_LABELS[property.occupancy]}
                      </Badge>
                    </td>
                    <td className={tdClass}>
                      {property.cashflowCount === 0 ? (
                        <span className="text-zinc-500 dark:text-zinc-400">
                          Aucun flux enregistré
                        </span>
                      ) : (
                        `${property.cashflowCount} entrée${property.cashflowCount > 1 ? "s" : ""}`
                      )}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatMoney({ amount: property.income, currency: property.currency })}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatMoney({ amount: property.expenses, currency: property.currency })}
                    </td>
                    <td
                      className={`${tdClass} text-right tabular-nums ${
                        property.net.isNegative() ? "text-rose-700 dark:text-rose-400" : ""
                      }`}
                    >
                      {formatMoney({ amount: property.net, currency: property.currency })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </Card>

          <Notice tone="info">
            Règle de comptage : un flux rattaché à une transaction reprend le montant de
            cette transaction et n&apos;enregistre pas de montant propre. Sans cette règle,
            la même somme apparaîtrait deux fois dans les totaux. Une échéance non réglée
            et dépassée est signalée dans le détail du bien.
          </Notice>
        </>
      )}
    </>
  );
}
