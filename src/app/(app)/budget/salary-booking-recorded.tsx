import Link from "next/link";
import { Notice } from "@/components/ui";
import { formatDateOnly } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { TransactionRecord } from "@/modules/budget/domain";

/**
 * What the Salaire and Prévisions tabs show once the month's salary is recorded.
 *
 * One sentence and one correction link, in both places: the booking is a single
 * transaction identified by its stable reference, and the two tabs must never tell two
 * stories about it. The notice deliberately reminds that the entry does not follow the
 * calendar afterwards — a figure already written into the accounts is corrected by hand,
 * like any other operation.
 */
export function RecordedSalaryNotice({
  monthKey,
  booking,
}: {
  /** `YYYY-MM`, for the correction link back to the operations tab. */
  monthKey: string;
  booking: TransactionRecord;
}) {
  return (
    <div className="flex flex-col items-start gap-2">
      <Notice tone="info">
        Recette déjà enregistrée :{" "}
        {formatMoney({ amount: booking.amount, currency: booking.currency })} le{" "}
        {formatDateOnly(booking.operationDate)}
        {booking.accountName ? ` (${booking.accountName})` : ""}. Si le calendrier du mois
        a changé depuis, corrigez l&apos;opération : cette recette ne se met pas à jour
        toute seule.
      </Notice>
      <Link
        href={`/budget?month=${monthKey}&tab=operations&edit=${booking.id}`}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        Corriger dans Opérations
      </Link>
    </div>
  );
}
