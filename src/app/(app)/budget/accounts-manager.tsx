"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Notice, inputClass, submitClass, tdClass } from "@/components/ui";
import { ACCOUNT_TYPE_LABELS, type AccountType } from "@/modules/budget/domain";
import { SUPPORTED_CURRENCIES, type Currency } from "@/lib/money";
import { setAccountArchivedAction, updateAccountAction } from "./actions";

/**
 * Account management: rename, retype, re-currency, archive and restore.
 *
 * The currency field is disabled as soon as the account holds a transaction: the server
 * refuses that change anyway (the app never converts, and the account's history is written
 * in its current currency), and a disabled control with the reason next to it is clearer
 * than an error after the click. Archiving is reversible by design — it is offered where
 * deletion might be expected, and nothing is lost.
 */

export type ManagedAccount = {
  id: string;
  name: string;
  type: AccountType;
  currency: Currency;
  archived: boolean;
  transactionCount: number;
};

type Draft = { name: string; type: AccountType; currency: Currency };

export function AccountsManager({ accounts }: { accounts: ManagedAccount[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [messages, setMessages] = useState<Record<string, { tone: "info" | "error"; text: string } | undefined>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();

  function setMessage(id: string, tone: "info" | "error", text: string) {
    setMessages((current) => ({ ...current, [id]: { tone, text } }));
  }

  function save(account: ManagedAccount) {
    if (!draft) {
      return;
    }

    startSave(async () => {
      const outcome = await updateAccountAction({ id: account.id, ...draft });

      if (outcome.status === "ok") {
        setEditingId(null);
        setDraft(null);
        setMessage(account.id, "info", "Compte mis à jour.");
        router.refresh();
        return;
      }

      setMessage(account.id, "error", outcome.message);
    });
  }

  function toggleArchived(account: ManagedAccount) {
    setBusyId(account.id);
    setMessages((current) => ({ ...current, [account.id]: undefined }));

    void setAccountArchivedAction({
      id: account.id,
      archived: account.archived ? "false" : "true",
    }).then((outcome) => {
      setBusyId(null);

      if (outcome.status === "ok") {
        setMessage(
          account.id,
          "info",
          outcome.message ?? (account.archived ? "Compte réactivé." : "Compte archivé."),
        );
        router.refresh();
        return;
      }

      setMessage(account.id, "error", outcome.message);
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">Gestion des comptes</caption>
        <thead>
          <tr>
            <th scope="col" className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              Compte
            </th>
            <th scope="col" className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              Type
            </th>
            <th scope="col" className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              Devise
            </th>
            <th scope="col" className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              État
            </th>
            <th scope="col" className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => {
            const editing = editingId === account.id && draft !== null;
            const message = messages[account.id];

            return (
              <tr key={account.id}>
                <td className={tdClass}>
                  {editing ? (
                    <input
                      className={inputClass}
                      aria-label={`Nom du compte ${account.name}`}
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      autoFocus
                    />
                  ) : (
                    account.name
                  )}
                </td>
                <td className={tdClass}>
                  {editing ? (
                    <select
                      className={inputClass}
                      aria-label={`Type du compte ${account.name}`}
                      value={draft.type}
                      onChange={(event) =>
                        setDraft({ ...draft, type: event.target.value as AccountType })
                      }
                    >
                      {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((type) => (
                        <option key={type} value={type}>
                          {ACCOUNT_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    ACCOUNT_TYPE_LABELS[account.type]
                  )}
                </td>
                <td className={tdClass}>
                  {editing ? (
                    <select
                      className={inputClass}
                      aria-label={`Devise du compte ${account.name}`}
                      value={draft.currency}
                      disabled={account.transactionCount > 0}
                      onChange={(event) =>
                        setDraft({ ...draft, currency: event.target.value as Currency })
                      }
                    >
                      {SUPPORTED_CURRENCIES.map((currency) => (
                        <option key={currency} value={currency}>
                          {currency}
                        </option>
                      ))}
                    </select>
                  ) : (
                    account.currency
                  )}
                  {editing && account.transactionCount > 0 ? (
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Devise verrouillée : le compte porte {account.transactionCount} opération
                      {account.transactionCount > 1 ? "s" : ""}, et rien n&apos;est converti.
                    </p>
                  ) : null}
                </td>
                <td className={tdClass}>
                  {account.archived ? (
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      Archivé
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Actif</span>
                  )}
                </td>
                <td className={tdClass}>
                  <div className="flex flex-col items-start gap-1">
                    {editing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => save(account)}
                          disabled={isSaving}
                          className={submitClass}
                        >
                          {isSaving ? "Enregistrement..." : "Enregistrer"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setDraft(null);
                          }}
                          disabled={isSaving}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          Annuler
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setDraft({
                              name: account.name,
                              type: account.type,
                              currency: account.currency,
                            });
                            setEditingId(account.id);
                            setMessages((current) => ({ ...current, [account.id]: undefined }));
                          }}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleArchived(account)}
                          disabled={busyId === account.id}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          {busyId === account.id
                            ? "..."
                            : account.archived
                              ? "Réactiver"
                              : "Archiver"}
                        </button>
                      </>
                    )}
                    {message ? (
                      <Notice tone={message.tone === "error" ? "error" : "info"}>
                        {message.text}
                      </Notice>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
