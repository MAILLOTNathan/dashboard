import Link from "next/link";
import { Card, Notice, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guard";
import { listAccounts } from "@/modules/budget/repository";
import { CsvImporter } from "./csv-importer";

export const dynamic = "force-dynamic";

/**
 * Manual CSV import (`/budget/import`).
 *
 * The file never leaves the browser: the client parses it, shows a preview and submits
 * only the normalised rows, which the Server Action validates again. No bank connection
 * is involved — this is the bulk alternative to typing a statement by hand (see
 * AGENTS.md: automatic bank connections stay out of scope).
 */
export default async function BudgetImportPage() {
  const user = await requireUser();
  const accounts = await listAccounts(user.id);

  return (
    <>
      <PageHeader
        title="Importer un relevé CSV"
        description="Import manuel d'un fichier exporté par votre banque. Le fichier est analysé dans votre navigateur, seules les lignes normalisées sont envoyées au serveur, et rien n'est transmis à un tiers."
        actions={
          <Link
            href="/budget?tab=operations"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Retour aux opérations
          </Link>
        }
      />

      {accounts.length === 0 ? (
        <Notice tone="warning">
          Aucun compte actif : créez d&apos;abord un compte dans l&apos;onglet Opérations,
          puis revenez ici. Un import a toujours un compte de destination : c&apos;est lui
          qui porte la devise, jamais le fichier.
        </Notice>
      ) : (
        <>
          <Card
            title="Fichier à importer"
            description="Formats de date acceptés : AAAA-MM-JJ et JJ/MM/AAAA (ou JJ-MM-AAAA, JJ.MM.AAAA, JJ/MM/AA). Montants : signés dans une colonne « Montant », ou « Débit » et « Crédit » séparés ; les parenthèses comptables (45,90) valent un montant négatif. Un montant négatif devient une dépense, un positif une recette — jamais un virement."
          >
            <CsvImporter
              accounts={accounts.map((account) => ({
                id: account.id,
                name: account.name,
                currency: account.currency,
              }))}
            />
          </Card>

          <Card
            title="Comment les doublons sont détectés"
            description="Un doublon est une ligne identique à une opération du compte : même date, même libellé (espaces normalisés), même montant. La vérification se fait à l'import, contre les opérations enregistrées et au sein du fichier lui-même. Une colonne « Référence » est enregistrée comme référence de source (préfixée import:), ce qui rend le même fichier réimportable sans doublon même après une correction de libellé."
          >
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Les catégories ne sont pas créées par l&apos;import : une colonne « Catégorie »
              ne rattache que les noms qui correspondent exactement à une catégorie existante
              du même type (recette pour un crédit, dépense pour un débit). Les autres lignes
              restent sans catégorie et le résumé le dit.
            </p>
          </Card>
        </>
      )}
    </>
  );
}
