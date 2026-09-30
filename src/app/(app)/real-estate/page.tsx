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
import { listProperties } from "@/modules/real-estate/repository";
import type { PropertyOccupancy } from "@/modules/real-estate/domain";

export const dynamic = "force-dynamic";

const OCCUPANCY_LABELS: Record<PropertyOccupancy, string> = {
  RENTED: "Loué",
  VACANT: "Vacant",
  OWNER_OCCUPIED: "Occupé par le propriétaire",
  SEASONAL: "Saisonnier",
  OTHER: "Autre",
};

export default async function RealEstatePage() {
  const user = await requireUser();
  const properties = await listProperties(user.id);

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
