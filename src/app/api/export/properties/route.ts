import { requireApiUser, unauthorizedResponse } from "@/lib/auth/guard";
import { createCsvResponse, toCsv, type CsvColumn } from "@/lib/csv";
import { toDateOnlyString } from "@/lib/dates";
import { listProperties } from "@/modules/real-estate/repository";

/** CSV export of the properties, with their totals. Authenticated server-side. */
export const dynamic = "force-dynamic";

type PropertyRow = {
  name: string;
  address: string;
  occupancy: string;
  purchaseDate: string;
  saleDate: string;
  currency: string;
  income: string;
  expenses: string;
  net: string;
  cashflowCount: string;
  notes: string;
};

const COLUMNS: CsvColumn<PropertyRow>[] = [
  { key: "name", header: "nom" },
  { key: "address", header: "adresse" },
  { key: "occupancy", header: "occupation" },
  { key: "purchaseDate", header: "date_acquisition" },
  { key: "saleDate", header: "date_cession" },
  { key: "currency", header: "devise" },
  { key: "income", header: "recettes" },
  { key: "expenses", header: "charges" },
  { key: "net", header: "solde" },
  { key: "cashflowCount", header: "nombre_de_flux" },
  { key: "notes", header: "notes" },
];

export async function GET(): Promise<Response> {
  const user = await requireApiUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const properties = await listProperties(user.id);

  const rows: PropertyRow[] = properties.map((property) => ({
    name: property.name,
    address: property.address ?? "",
    occupancy: property.occupancy,
    purchaseDate: property.purchaseDate ? toDateOnlyString(property.purchaseDate) : "",
    saleDate: property.saleDate ? toDateOnlyString(property.saleDate) : "",
    currency: property.currency,
    income: property.income.toFixed(2),
    expenses: property.expenses.toFixed(2),
    net: property.net.toFixed(2),
    cashflowCount: String(property.cashflowCount),
    notes: property.notes ?? "",
  }));

  return createCsvResponse(toCsv(rows, COLUMNS), "immobilier.csv");
}
