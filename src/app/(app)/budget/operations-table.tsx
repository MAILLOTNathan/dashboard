"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Notice, TableShell, inputClass, tdClass, thClass } from "@/components/ui";
import {
  categoryKindForTransactionType,
  TRANSACTION_TYPES,
  type AccountSummary,
  type CategorySummary,
  type TransactionFormInitialValues,
  type TransactionType,
} from "@/modules/budget/domain";
import { DeleteTransactionButton } from "./delete-transaction-button";
import { setTransactionReconciledAction, updateTransactionAction } from "./actions";

/**
 * The month's operations, editable in place.
 *
 * This is the spreadsheet side of the page (see AGENTS.md): each row can be turned into
 * inputs without leaving the list, with the same server validation as the full form —
 * Enter saves, Escape cancels, and a refusal is printed under the row instead of
 * disappearing. Only the columns are editable here; notes stay in the full form, linked
 * from the action cell, because a two-line textarea inside a table cell is a bad trade.
 *
 * A row that belongs to a linked transfer is not editable (the two halves are one
 * movement) and is deleted as a whole, hence the dedicated wording on its buttons.
 * Everything is strings-only on the way in and on the way out: no `Decimal`, no `Date`.
 */

const TYPE_LABELS: Record<TransactionType, string> = {
  INCOME: "Recette",
  EXPENSE: "Dépense",
  TRANSFER: "Transfert",
};

export type OperationsTableRow = {
  id: string;
  /** Strings-only row values, the same DTO the full form receives. */
  values: TransactionFormInitialValues;
  accountName: string;
  categoryName: string | null;
  typeLabel: string;
  amountLabel: string;
  dateLabel: string;
  isNegative: boolean;
  reconciled: boolean;
  /** "05/10/2026" when the line was checked, null otherwise. */
  reconciledLabel: string | null;
  externalRef: string | null;
  transferGroupId: string | null;
};

type Draft = {
  operationDate: string;
  label: string;
  accountId: string;
  categoryId: string;
  type: TransactionType;
  amount: string;
};

function draftOf(row: OperationsTableRow): Draft {
  return {
    operationDate: row.values.operationDate,
    label: row.values.label,
    accountId: row.values.accountId,
    categoryId: row.values.categoryId,
    type: row.values.type,
    amount: row.values.amount,
  };
}

export function OperationsTable({
  rows,
  accounts,
  categories,
  listHref,
  sortHrefs,
  sort,
  dir,
}: {
  rows: OperationsTableRow[];
  accounts: AccountSummary[];
  categories: CategorySummary[];
  /** The list's own URL (month, filters, sort, page), base of the row links. */
  listHref: string;
  sortHrefs: Record<"date" | "amount" | "label", string>;
  sort: "date" | "amount" | "label" | undefined;
  dir: "asc" | "desc";
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errorsById, setErrorsById] = useState<Record<string, string | undefined>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();

  function setRowError(id: string, message: string | undefined) {
    setErrorsById((current) => ({ ...current, [id]: message }));
  }

  function startEdit(row: OperationsTableRow) {
    setDraft(draftOf(row));
    setEditingId(row.id);
    setRowError(row.id, undefined);
  }

  function cancelEdit(row: OperationsTableRow) {
    setEditingId(null);
    setDraft(null);
    setRowError(row.id, undefined);
  }

  function save(row: OperationsTableRow) {
    if (!draft) {
      return;
    }

    startSave(async () => {
      const outcome = await updateTransactionAction({
        id: row.id,
        accountId: draft.accountId,
        categoryId: draft.categoryId,
        type: draft.type,
        label: draft.label,
        amount: draft.amount,
        operationDate: draft.operationDate,
        // Notes are not edited here: they travel unchanged from the stored row.
        notes: row.values.notes,
      });

      if (outcome.status === "ok") {
        setEditingId(null);
        setDraft(null);
        setRowError(row.id, undefined);
        router.refresh();
        return;
      }

      setRowError(row.id, outcome.message);
    });
  }

  function toggleReconciled(row: OperationsTableRow) {
    setBusyId(row.id);
    setRowError(row.id, undefined);

    void setTransactionReconciledAction({
      id: row.id,
      reconciled: row.reconciled ? "false" : "true",
    }).then((outcome) => {
      setBusyId(null);

      if (outcome.status === "ok") {
        router.refresh();
        return;
      }

      setRowError(row.id, outcome.message);
    });
  }

  /** Type change clears a category whose kind no longer matches, like the full form. */
  function changeType(nextType: TransactionType) {
    if (!draft) {
      return;
    }

    const selected = categories.find((category) => category.id === draft.categoryId);
    const expected = categoryKindForTransactionType(nextType);

    setDraft({
      ...draft,
      type: nextType,
      categoryId:
        selected !== undefined && expected !== null && selected.kind === expected
          ? draft.categoryId
          : "",
    });
  }

  const selectableCategories = categories.filter(
    (category) => draft !== null && category.kind === categoryKindForTransactionType(draft.type),
  );

  function editorKeys(row: OperationsTableRow) {
    return {
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelEdit(row);
        }
        if (event.key === "Enter") {
          event.preventDefault();
          save(row);
        }
      },
    };
  }

  return (
    <TableShell caption="Opérations du mois, éditables en place">
      <thead>
        <tr>
          <th scope="col" className={thClass} aria-sort={sort === "date" ? (dir === "asc" ? "ascending" : "descending") : "none"}>
            <Link href={sortHrefs.date} className="underline-offset-2 hover:underline">
              Date{sort === "date" ? (dir === "asc" ? " ↑" : " ↓") : ""}
            </Link>
          </th>
          <th scope="col" className={thClass} aria-sort={sort === "label" ? (dir === "asc" ? "ascending" : "descending") : "none"}>
            <Link href={sortHrefs.label} className="underline-offset-2 hover:underline">
              Libellé{sort === "label" ? (dir === "asc" ? " ↑" : " ↓") : ""}
            </Link>
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
          <th scope="col" className={`${thClass} text-right`} aria-sort={sort === "amount" ? (dir === "asc" ? "ascending" : "descending") : "none"}>
            <Link href={sortHrefs.amount} className="underline-offset-2 hover:underline">
              Montant{sort === "amount" ? (dir === "asc" ? " ↑" : " ↓") : ""}
            </Link>
          </th>
          <th scope="col" className={thClass}>
            Pointé
          </th>
          <th scope="col" className={thClass}>
            Action
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const editing = editingId === row.id && draft !== null;
          const grouped = row.transferGroupId !== null;

          return (
            <FragmentRow
              key={row.id}
              editing={editing}
              error={errorsById[row.id]}
            >
              {editing ? (
                <>
                  <td className={tdClass}>
                    <input
                      type="date"
                      aria-label="Date de l'opération"
                      className={inputClass}
                      value={draft.operationDate}
                      onChange={(event) =>
                        setDraft({ ...draft, operationDate: event.target.value })
                      }
                      autoFocus
                      {...editorKeys(row)}
                    />
                  </td>
                  <td className={tdClass}>
                    <input
                      aria-label="Libellé"
                      className={inputClass}
                      value={draft.label}
                      onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                      {...editorKeys(row)}
                    />
                  </td>
                  <td className={tdClass}>
                    <select
                      aria-label="Compte"
                      className={inputClass}
                      value={draft.accountId}
                      onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}
                      {...editorKeys(row)}
                    >
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={tdClass}>
                    <select
                      aria-label="Catégorie"
                      className={inputClass}
                      value={draft.categoryId}
                      onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
                      {...editorKeys(row)}
                    >
                      <option value="">Sans catégorie</option>
                      {selectableCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={tdClass}>
                    <select
                      aria-label="Type"
                      className={inputClass}
                      value={draft.type}
                      onChange={(event) => changeType(event.target.value as TransactionType)}
                      {...editorKeys(row)}
                    >
                      {TRANSACTION_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={tdClass}>
                    <input
                      aria-label="Montant"
                      inputMode="decimal"
                      className={`${inputClass} text-right`}
                      value={draft.amount}
                      onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
                      {...editorKeys(row)}
                    />
                  </td>
                  <td className={tdClass}>{row.reconciled ? "Pointé" : "—"}</td>
                  <td className={tdClass}>
                    <div className="flex flex-col items-start gap-1">
                      <button
                        type="button"
                        onClick={() => save(row)}
                        disabled={isSaving}
                        className="rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                      >
                        {isSaving ? "Enregistrement..." : "Enregistrer"}
                      </button>
                      <button
                        type="button"
                        onClick={() => cancelEdit(row)}
                        disabled={isSaving}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        Annuler
                      </button>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        Entrée enregistre, Échap annule.
                      </span>
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td className={`${tdClass} whitespace-nowrap tabular-nums`}>
                    {row.dateLabel}
                  </td>
                  <td className={tdClass}>
                    {row.values.label}
                    {row.externalRef ? (
                      <span className="ml-2 text-xs text-zinc-400">
                        (réf. {row.externalRef})
                      </span>
                    ) : null}
                    {grouped ? (
                      <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                        virement lié
                      </span>
                    ) : null}
                  </td>
                  <td className={tdClass}>{row.accountName}</td>
                  <td className={tdClass}>{row.categoryName ?? "—"}</td>
                  <td className={tdClass}>{row.typeLabel}</td>
                  <td
                    className={`${tdClass} whitespace-nowrap text-right tabular-nums ${
                      row.isNegative ? "text-rose-700 dark:text-rose-400" : ""
                    }`}
                  >
                    {row.amountLabel}
                  </td>
                  <td className={tdClass}>
                    <button
                      type="button"
                      aria-pressed={row.reconciled}
                      title={
                        row.reconciledLabel
                          ? `Pointé le ${row.reconciledLabel}`
                          : "Pas encore vérifié sur le relevé"
                      }
                      onClick={() => toggleReconciled(row)}
                      disabled={busyId === row.id}
                      className={`rounded-md border px-2 py-1 text-xs disabled:opacity-60 ${
                        row.reconciled
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                          : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {row.reconciled ? "Pointé" : "Pointer"}
                    </button>
                  </td>
                  <td className={tdClass}>
                    <div className="flex flex-col items-start gap-1">
                      {grouped ? (
                        <DeleteTransactionButton
                          transactionId={row.id}
                          label={row.values.label}
                          grouped
                        />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                          >
                            Modifier
                          </button>
                          <Link
                            href={`${listHref}&copy=${row.id}`}
                            className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                          >
                            Dupliquer
                          </Link>
                          <Link
                            href={`${listHref}&edit=${row.id}`}
                            className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400"
                          >
                            Formulaire complet
                          </Link>
                          <DeleteTransactionButton transactionId={row.id} label={row.values.label} />
                        </>
                      )}
                    </div>
                  </td>
                </>
              )}
            </FragmentRow>
          );
        })}
      </tbody>
    </TableShell>
  );
}

/** One row plus its optional error line, shared by the static and editing states. */
function FragmentRow({
  editing,
  error,
  children,
}: {
  editing: boolean;
  error: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr className={editing ? "bg-amber-50 dark:bg-amber-950/30" : undefined}>
        {children}
      </tr>
      {error ? (
        <tr>
          <td colSpan={8} className={tdClass}>
            <Notice tone="error">{error}</Notice>
          </td>
        </tr>
      ) : null}
    </>
  );
}
