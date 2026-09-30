import { Card, Notice, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guard";
import { PASSWORD_MIN_LENGTH } from "@/modules/identity/domain";
import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";

/**
 * Owner account.
 *
 * The only page that changes a credential, and the only one that shows the identity
 * back to its owner: there is no public sign-up, so the address and the name come
 * from the seed script. Nothing here is read from an integration and no secret is
 * displayed.
 */
export default async function AccountPage() {
  const user = await requireUser();

  // Read at request time: with this flag the seed would overwrite the stored hash at
  // the next restart. Saying so on the page is cheaper than a password that reverts
  // with no explanation.
  const seedForcesPassword = process.env.SEED_OWNER_FORCE_PASSWORD === "true";

  return (
    <>
      <PageHeader
        title="Compte"
        description="Adresse, nom et mot de passe du propriétaire. Aucune inscription publique : ce compte est le seul."
      />

      {seedForcesPassword ? (
        <Notice tone="warning">
          SEED_OWNER_FORCE_PASSWORD vaut « true » : au prochain démarrage de la pile, le
          script de départ réécrira le mot de passe avec la valeur de SEED_OWNER_PASSWORD.
        </Notice>
      ) : null}

      <Card
        title="Identité"
        description="Ces deux valeurs viennent du script de départ (SEED_OWNER_EMAIL et SEED_OWNER_NAME) : elles ne se modifient pas depuis cette page."
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Adresse e-mail
            </dt>
            <dd className="mt-0.5 font-medium">{user.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Nom affiché
            </dt>
            <dd className="mt-0.5 font-medium">{user.name ?? "Non renseigné"}</dd>
          </div>
        </dl>
      </Card>

      <Card
        title="Mot de passe"
        description={`Au moins ${PASSWORD_MIN_LENGTH} caractères. Le mot de passe actuel est demandé, et un changement déconnecte toutes les sessions.`}
      >
        <ChangePasswordForm />
      </Card>
    </>
  );
}
