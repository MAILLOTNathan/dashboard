import Decimal from "decimal.js";

/**
 * Internal transfers between two accounts, entered as one action and written as two
 * linked movements.
 *
 * The stored rule is unchanged: a transfer is a TRANSFER row whose sign says which way
 * the money went (see `computeMonthlyTotals`). A linked transfer simply records **both**
 * legs at once and tags them with a shared `transferGroupId`, so the pair can be shown
 * and removed as one thing:
 *
 * - the source leg is negative (money leaving the source account),
 * - the destination leg is positive (money arriving),
 * - both legs carry their own account's currency, and the two currencies must match —
 *   the app never converts, so a linked transfer exists within one currency only.
 *
 * A single-leg transfer (money sent to a savings account that is not tracked here) stays
 * possible: it is simply typed by hand, without a group. Everything that reports on
 * transfers therefore keeps working on the sign, not on the group.
 */

/** Labels of the two legs, from the two account names. */
export function defaultTransferLabels(
  fromName: string,
  toName: string,
): { source: string; destination: string } {
  return {
    source: `Virement vers ${toName}`,
    destination: `Virement depuis ${fromName}`,
  };
}

/**
 * The sign rule in one place: `amount` is the positive magnitude moved, the source leg
 * is its negation and the destination leg its copy.
 */
export function signedTransferLegs(amount: Decimal): { out: Decimal; in: Decimal } {
  return { out: amount.negated(), in: amount };
}

/**
 * Why an edit of one leg is refused, or `null` when the row can be edited normally.
 *
 * Both legs are one movement: correcting one of them independently would let the two
 * halves diverge (a virement that does not balance), and nothing on screen would say so.
 * Deleting the group and re-entering it is the honest path.
 */
export function transferLegEditRefusedReason(
  transferGroupId: string | null,
): string | null {
  if (transferGroupId === null) {
    return null;
  }

  return "Ce mouvement fait partie d'un virement entre comptes : corrigez-le en supprimant le virement (les deux mouvements) puis en le réenregistrant, pour que les deux moitiés restent cohérentes.";
}

/** Confirmation text shared by the two-step group deletion. */
export const TRANSFER_GROUP_DELETE_LABEL = "Supprimer le virement (2 mouvements)";
